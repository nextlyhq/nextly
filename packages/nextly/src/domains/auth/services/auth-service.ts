      // Checked, applied and spent in one transaction, holding the account's
      // row: an address change or a deletion running at the same time either
      // commits first, and the link is refused, or waits for the reset.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TokenTransaction;
        const account = await this.redeemingAccount(tx, resetToken);
        if (!account) {
          throw this.invalidResetLinkError({
            reason: "reset-token-account-changed",
            tokenId: resetToken.id,
          });
        }

        // Spent before the password is written, and only by one caller: two
        // redemptions of one link can both pass the read above, and the
        // conditional update lets exactly one flip used_at. Zero rows also
        // means the link was revoked, or expired, since it was read — the
        // claim's own boundary (expires > now) tells those apart: an
        // instant-equal or past expiry is the expiration answer, and
        // anything else is the shared invalid link.
        const spent = await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.id, resetToken.id),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expires, new Date()),
              eq(passwordResetTokens.userId, account.id)
            )
          );
        if (affectedRowCount(spent, this.dialect) !== 1) {
          if (resetToken.expires <= new Date()) {
            throw this.resetTokenExpiredError(resetToken);
          }
          throw this.invalidResetLinkError({
            reason: "reset-token-spent-or-revoked",
            tokenId: resetToken.id,
          });
        }

        // The own-password write `changePassword` makes: conditional on the
        // account not being deactivated, in the same statement that sets the
        // password, and ending every session the account holds. An
        // administrator may have switched the account off while the new
        // password was being hashed, and the read above would not have seen
        // it; the credentials stay frozen in that window too. Whoever asked
        // for the reset may not be the only one holding a session, so the
        // reset ends them all on every path that resets. Throwing rolls the
        // spend back with it.
        const reset = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId: account.id,
            adapter: this.adapter,
            set: passwordColumns(passwordHash),
            unlessDeactivated: true,
            when: eq(users.email, email),
          }
        );
        if (reset !== 1) {
          throw this.invalidResetLinkError({
            reason: "reset-token-deactivated",
            tokenId: resetToken.id,
          });
        }
      });
        const reset = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId: account.id,
            adapter: this.adapter,
            set: passwordColumns(passwordHash),
            unlessDeactivated: true,
            when: eq(users.email, email),
          }
        );
        if (reset !== 1) {
          throw this.invalidResetLinkError({
            reason: "reset-token-deactivated",
            tokenId: resetToken.id,
          });
        }
      });
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors before mapping.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    emitAuthEvent("passwordReset", { email });

    return { email };
  }

  /**
   * The one construction of the reset-token TOKEN_EXPIRED answer: §13.8
   * mandates the canonical session-expired public message, and the
   * per-token identifier moves into logContext. Raised from both places
   * that can see a past-expiry token — the pre-transaction expiry check
   * and the failed-claim branch, where the token expired between that
   * check and the consumption write.
   */
  private resetTokenExpiredError(resetToken: {
    id: number;
    expires: Date;
  }): NextlyError {
    return new NextlyError({
      code: "TOKEN_EXPIRED",
      publicMessage: "Your session has expired. Please sign in again.",
      logContext: {
        reason: "reset-token-expired",
        tokenId: resetToken.id,
        expiredAt: resetToken.expires,
      },
    });
  }

  /**
   * Send email verification token.
   *
   * @returns `{}` on success when the email service handled delivery, or
   *   `{ token }` for dev-fallback paths (no email provider, or send
   *   failure). Mirrors the silent-success contract of
   *   {@link generatePasswordResetToken}.
   * @throws NextlyError on DB errors.
   */
  async generateEmailVerificationToken(
    email: string,
    options?: { redirectPath?: string; disableEmail?: boolean }
  ): Promise<{ token?: string }> {
    // The account selection is the canonical resolver's — exact spelling
    // first, then the normalized form — so a resend verifies the same
    // account a lookup names, and any future change to how legacy rows are
    // resolved lands in one place.
    const queryService = new UserQueryService(this.adapter, this.logger);

    try {
      const user = await queryService.findByEmail(email);

      // Silent success either way, so neither case reveals the account.
      if (!user || !(await this.awaitsVerificationLink(user))) {
        return {};
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      // The token is keyed to the matched account's STORED spelling:
      // verifyEmail redeems it only while the account holds exactly that
      // address, so a legacy mixed-case row keyed by its canonical form could
      // never be verified.
      const identifier = user.email;
      const expiresAt = new Date(Date.now() + AUTH_TOKEN_LIFETIME_MS);

      // Issued for the matched account, holding its row, as a reset link is.
      // An account that moved or was deleted since the lookup gets nothing.
      const issued = await this.issueToken("email-verification", {
        email: identifier,
        userId: String(user.id),
        tokenHash,
        expiresAt,
      });
      if (!issued) return {};

      if (options?.disableEmail) {
        return { token: rawToken };
      }

      return await this.deliverVerificationEmail(
        email,
        { id: String(user.id), name: user.name, email: user.email },
        rawToken,
        options?.redirectPath
      );
    } catch (error) {
      // A malformed address surfaces as the resolver's VALIDATION_ERROR, not
      // as a database failure dressed up as a 500.
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Whether a verification link would do anything for this account.
   *
   * Not for an address already verified: the link would mail someone who only
   * forgot their password. Not for an account an administrator deactivated:
   * following the link no longer switches it on, so it would only invite the
   * owner to try.
   */
  private async awaitsVerificationLink(user: {
    id: string | number;
    emailVerified?: Date | string | null;
  }): Promise<boolean> {
    if (user.emailVerified) return false;
    const row = await this.db.query.users.findFirst({
      where: { id: requireFilterValue(String(user.id), "userId") },
      columns: { deactivatedAt: true },
    });
    return !row?.deactivatedAt;
  }

  /**
   * Send the verification link, or hand back the token when nothing could.
   *
   * Separate from issuing the token so that method reads as the decision —
   * which account, and whether it needs a link at all — and this one as the
   * delivery and its fallback.
   */
  private async deliverVerificationEmail(
    email: string,
    recipient: { id: string; name: string | null; email: string },
    rawToken: string,
    redirectPath: string | undefined
  ): Promise<{ token?: string }> {
    if (!this.emailService) {
      this.logger.warn(
        "No email provider is configured, so the verification token could not be delivered",
        { event: "auth.email_verification.email_unconfigured" }
      );
      return this.undeliveredTokenFallback(rawToken);
    }

    let delivered = false;
    try {
      // Same reasoning as the password-reset path: a provider failure
      // arrives as `{ success: false }`, not as a throw, so the result is
      // the only evidence that nothing reached the user.
      const result = await this.emailService.sendEmailVerificationEmail(
        email,
        { name: recipient.name, email: recipient.email },
        rawToken,
        // Names the staff user on the delivery records.
        { path: redirectPath, staffUserId: recipient.id }
      );
      delivered = result.success;
      if (!delivered) {
        this.logger.error("Email verification message was not delivered", {
          event: "auth.email_verification.email_failed",
          reason: "not-delivered-to-recipient",
        });
      }
    } catch (emailError) {
      this.logger.error("Failed to send email verification email", {
        event: "auth.email_verification.email_failed",
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
      });
    }

    return delivered ? {} : this.undeliveredTokenFallback(rawToken);
  }

  /**
   * Verify email with token.
   *
   * @returns The verified email address.
   * @throws NextlyError(VALIDATION_ERROR) when the token is unknown.
   * @throws NextlyError(TOKEN_EXPIRED) when the token is past expiry.
   * @throws NextlyError on DB errors during the verification transaction.
   */
  async verifyEmail(token: string): Promise<{ email: string }> {
    const verificationToken = await this.findVerificationToken(token);

    if (!verificationToken) {
      throw NextlyError.validation({
        errors: [
          {
            path: "token",
            code: "INVALID",
            message:
              "The verification link is invalid or has already been used.",
          },
        ],
        logContext: { reason: "verification-token-not-found" },
      });
    }

    if (tokenExpired(verificationToken)) {
      throw new NextlyError({
        code: "TOKEN_EXPIRED",
        publicMessage: "Your session has expired. Please sign in again.",
        logContext: {
          reason: "verification-token-expired",
          tokenId: verificationToken.id,
          expiredAt: verificationToken.expires,
        },
      });
    }

    const email = verificationToken.identifier;
    const { emailVerificationTokens, users } = this.tables;

    try {
      // Checked, applied and spent in one transaction, holding the account's
      // row, so an address change or a deletion running at the same time is
      // ordered against it.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TokenTransaction;
        const account = await this.redeemingAccount(tx, verificationToken);
        if (!account) {
          throw this.invalidVerificationLinkError({
            reason: "verification-token-account-changed",
            tokenId: verificationToken.id,
          });
        }

        // Spent first, by exactly one caller; zero rows means another
        // redemption spent it, or an address change revoked it, since the
        // read above.
        const spent = await tx
          .delete(emailVerificationTokens)
          .where(
            and(
              eq(emailVerificationTokens.id, verificationToken.id),
              eq(emailVerificationTokens.userId, account.id)
            )
          );
        if (affectedRowCount(spent, this.dialect) !== 1) {
          throw this.invalidVerificationLinkError({
            reason: "verification-token-spent-or-revoked",
            tokenId: verificationToken.id,
          });
        }

        // Mark the email verified, and activate the account. Self-verification
        // (whether initiated by /auth/register or by an admin invite with
        // sendWelcomeEmail=true) is what activates the account — both
        // paths funnel through here. An admin can still manually activate
        // a user without email verification via the user-mutation path.
        await tx
          .update(users)
          .set(emailVerificationColumns(new Date(), "link"))
          .where(eq(users.id, account.id));
        // Activation is conditional in the statement itself: an account an
        // administrator deactivated stays inactive, including when its link
        // was sent before the deactivation. The address is still verified —
        // following the link proved it — so reactivating needs no new link.
        await tx
          .update(users)
          .set({ isActive: true })
          .where(and(eq(users.id, account.id), isNull(users.deactivatedAt)));
      });
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors before mapping.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    emitAuthEvent("emailVerified", { email });

    return { email };
  }

  /**
   * Mint a single-use set-password link for an existing account.
   *
   * The link is the artifact an admin hands to a new user; email is only ever
   * one way to deliver it. Follows the same shape as a password-reset token —
   * a 256-bit random value of which only the SHA-256 hash is stored, one active
   * token per account — but keyed on the user id and given a longer life.
   *
   * The raw token is returned to the caller and never persisted. There is no
   * way to recover it afterwards; mint a new one instead.
   */
  async generateInviteToken(userId: string): Promise<InviteTokenResult> {
    const user = await this.db.query.users.findFirst({
      // rqb v2 object filter (drizzle v1)
      where: { id: requireFilterValue(userId, "userId") },
      columns: { id: true, deactivatedAt: true },
    });
    if (!user) {
      throw NextlyError.notFound({ logContext: { userId } });
    }
    // Accepting an invite is refused while the account is deactivated, so a
    // link minted now could only ever fail for the person it was sent to.
    // The administrator is told instead, while they can still act on it.
    if (user.deactivatedAt) {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This account is deactivated. Activate it before sending an invite.",
        logContext: { userId },
      });
    }

    const {
      token: rawToken,
      tokenHash,
      expiresAt,
    } = generateInviteTokenValue();

    try {
      // One active invite per account, in one transaction: a freshly minted
      // link supersedes any earlier one, and if the insert fails the delete
      // rolls back so the previous link stays valid rather than the account
      // being left with none. The unique index on user_id serialises two
      // concurrent re-invites so they cannot both leave a live link.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;
        await tx
          .delete(this.tables.userInviteTokens)
          .where(eq(this.tables.userInviteTokens.userId, userId));

        await tx.insert(this.tables.userInviteTokens).values({
          userId,
          tokenHash,
          expires: expiresAt,
        });
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return { token: rawToken, expiresAt };
  }

  /** The one public error every unusable-invite path returns. */
  private invalidInviteError(
    logContext?: Record<string, unknown>
  ): NextlyError {
    return NextlyError.validation({
      errors: [
        {
          path: "token",
          code: "INVALID_INVITE",
          message: "This invite link is invalid or has expired.",
        },
      ],
      logContext,
    });
  }

  /**
   * Accept an invite: set the account's password and let it sign in.
   *
   * Clicking a link that was delivered to an address is itself proof of the
   * address, so acceptance sets `emailVerified` and `isActive` alongside the
   * password in one transaction — there is no separate verification round trip,
   * and no window where the account has a password but still cannot sign in.
   *
   * An account an administrator deactivated is refused instead, without
   * setting the password: an invite must not set credentials on, or switch
   * back on, an account someone turned off.
   *
   * The failure messages do not distinguish "never existed" from "already
   * used" from "expired-by-a-second" from "deactivated", to avoid confirming
   * which invites are live to whoever holds a guessed token.
   */
  async acceptInvite(
    token: string,
    newPassword: string
  ): Promise<AcceptInviteResult> {
    const invite = await this.findUnusedInviteToken(token);

    // Unknown, already used, and expired all return the same error, so a
    // guessed token cannot tell a live invite from a dead one. The expiry
    // detail is kept for the log only.
    if (!invite || tokenExpired(invite)) {
      throw this.invalidInviteError(
        invite ? { inviteId: invite.id, expiredAt: invite.expires } : undefined
      );
    }

    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.ok) {
      throw NextlyError.validation({
        errors: passwordStrength.errors.map(message => ({
          path: "newPassword",
          code: "WEAK_PASSWORD",
          message,
        })),
      });
    }

    const passwordHash = await hashPasswordBcrypt(newPassword);

    // Claim the token before touching the account. Two acceptances can both
    // pass the read above; the conditional update lets exactly one flip
    // usedAt from null, and only that one goes on to set the password — so a
    // race cannot end with two different passwords, last-writer-wins.
    let claimed = false;
    try {
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;

        const claim = await tx
          .update(this.tables.userInviteTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(this.tables.userInviteTokens.id, invite.id),
              isNull(this.tables.userInviteTokens.usedAt),
              gt(this.tables.userInviteTokens.expires, new Date())
            )
          );

        // Zero rows: another acceptance already claimed it, or it expired
        // between the read and here. Leave the account untouched.
        if (affectedRowCount(claim, this.dialect) !== 1) return;
        claimed = true;

        // Conditional on the account not being deactivated by an
        // administrator, in the same statement that sets the password: an
        // invite must not set credentials on, or re-activate, an account an
        // administrator switched off. Throwing here rolls the claim back too,
        // and the refusal reads like any other dead invite. Through the
        // shared password write, so any session the account already holds
        // ends with the password it was issued under.
        const accepted = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId: invite.userId,
            adapter: this.adapter,
            set: {
              ...passwordColumns(passwordHash),
              // Receiving the invite at this address is what proves it.
              ...emailVerificationColumns(new Date(), "invite"),
              isActive: true,
            },
            unlessDeactivated: true,
          }
        );
        if (accepted !== 1) {
          throw this.invalidInviteError({
            inviteId: invite.id,
            reason: "account-deactivated",
          });
        }
      });
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    if (!claimed) {
      throw this.invalidInviteError({
        inviteId: invite.id,
        reason: "already-claimed",
      });
    }

    // No auth event is emitted: the closest existing one, passwordChanged,
    // carries "an established password was rotated" semantics and its listeners
    // (e.g. a security-notification email) would be wrong for a first set.

    return { userId: invite.userId };
  }

  /**
   * Replace an admin-set password on forced first sign-in and clear the
   * must-change flag (ASVS 6.4.1). The update is conditional on the flag still
   * being set, so a replayed or concurrent call cannot re-set the password
   * after it has already been changed — exactly one call flips the flag, and
   * only that one writes the new password.
   *
   * Returns the password version it wrote, as stored, so the session the
   * change goes on to issue is judged against this password and not against
   * whatever a later read finds.
   *
   * @throws NextlyError(VALIDATION_ERROR) on a weak password.
   * @throws NextlyError(INVALID_INPUT) when the account is not (or is no longer)
   *   in the must-change state.
   */
  async setInitialPassword(
    userId: string,
    newPassword: string
  ): Promise<{
    userId: string;
    passwordUpdatedAt: Date | null;
    sessionEpoch: number;
  }> {
    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.ok) {
      throw NextlyError.validation({
        errors: passwordStrength.errors.map(message => ({
          path: "newPassword",
          code: "WEAK_PASSWORD",
          message,
        })),
      });
    }

    // The admin-set password must actually be replaced. A fresh bcrypt salt
    // makes the same plaintext hash differently, so without this check a person
    // could "set" the temporary password again — clearing the flag while
    // leaving the password the admin knows (ASVS 6.4.1). Reject a match, and
    // reject an account that is not (or no longer) in the must-change state.
    const current = await this.db.query.users.findFirst({
      // rqb v2 object filter (drizzle v1)
      where: { id: requireFilterValue(userId, "userId") },
      columns: { passwordHash: true, mustChangePassword: true },
    });
    if (!current || current.mustChangePassword !== true) {
      throw new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "This request is no longer valid. Please sign in again.",
        logContext: { userId, reason: auditReason("not-in-must-change-state") },
      });
    }
    if (
      current.passwordHash &&
      (await verifyPasswordBcrypt(newPassword, current.passwordHash))
    ) {
      throw NextlyError.validation({
        errors: [
          {
            path: "newPassword",
            code: "PASSWORD_REUSED",
            message:
              "Choose a password different from the temporary one you were given.",
          },
        ],
      });
    }

    const passwordHash = await hashPasswordBcrypt(newPassword);

    // The version as stored, read back in the transaction that wrote it:
    // MySQL and SQLite keep whole seconds, so the value written here is not
    // the one a later read compares against. The session epoch the write
    // raised comes back with it, for the same reason: it is what tells a
    // reset in the same second apart.
    let written:
      | { passwordUpdatedAt: Date | null; sessionEpoch: number | null }
      | undefined;
    try {
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;
        // Through the shared password write, so the account's sessions end
        // with the admin-set password. Conditional on the flag still being
        // set and, in the same statement, on the account not being
        // deactivated: an administrator may have switched it off after the
        // pending token was issued, and a zero-row write falls to the
        // not-in-must-change-state refusal below — no password planted for a
        // later reactivation to switch on.
        const claimed = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId,
            set: passwordColumns(passwordHash),
            unlessDeactivated: true,
            when: eq(this.tables.users.mustChangePassword, true),
            adapter: this.adapter,
          }
        );
        if (claimed !== 1) return;
        const [row] = await tx
          .select({
            passwordUpdatedAt: this.tables.users.passwordUpdatedAt,
            sessionEpoch: this.tables.users.sessionEpoch,
          })
          .from(this.tables.users)
          .where(eq(this.tables.users.id, userId))
          .limit(1);
        written = row;
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    if (!written) {
      throw new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "This request is no longer valid. Please sign in again.",
        logContext: { userId, reason: auditReason("not-in-must-change-state") },
      });
    }

    return {
      userId,
      passwordUpdatedAt: written.passwordUpdatedAt,
      sessionEpoch: Number(written.sessionEpoch ?? 0),
    };
  }

  /**
   * The address a live password-reset token was issued to, or `null` when
   * the token is unknown, used or expired. Reads only: the token stays
   * usable. The auth limiter asks it to count a reset whose client address
   * cannot be resolved against the account it would reset.
   */
  async resetTokenOwner(token: string): Promise<string | null> {
    const row = await this.findUnusedResetToken(token);
    // Only a token redemption would honour names an owner: one with no
    // account is refused there until the core reconcile binds it.
    return row && row.userId !== null && !tokenExpired(row)
      ? row.identifier
      : null;
  }

  /**
   * The address a live email-verification token was issued to, or `null`
   * when it is unknown or expired. Reads only, as {@link resetTokenOwner}.
   */
  async verificationTokenOwner(token: string): Promise<string | null> {
    const row = await this.findVerificationToken(token);
    // Only a token redemption would honour names an owner: one with no
    // account is refused there until the core reconcile binds it.
    return row && row.userId !== null && !tokenExpired(row)
      ? row.identifier
      : null;
  }

  /**
   * The address of the account a live invite token sets up, or `null` when
   * the invite is unknown, used or expired, or its account is gone. Reads
   * only, as {@link resetTokenOwner}.
   */
  async inviteTokenOwner(token: string): Promise<string | null> {
    const invite = await this.findUnusedInviteToken(token);
    if (!invite || tokenExpired(invite)) return null;
    let user: { email: string } | undefined;
    try {
      user = await this.db.query.users.findFirst({
        where: { id: requireFilterValue(invite.userId, "id") },
        columns: { email: true },
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
    return user?.email ?? null;
  }

  /*
   * The stored-token reads. Each is the ONE read of its kind: the method that
   * consumes a token and the lookup that names its owner both make it, and
   * both judge the row with `tokenExpired`, so the two cannot come to
   * disagree about which tokens are live.
   */

  /** The unused password-reset token stored for `token`, if any. */
  private async findUnusedResetToken(
    token: string
  ): Promise<StoredTokenRow | undefined> {
    const tokenHash = storedTokenHash(token);
    try {
      return await this.db.query.passwordResetTokens.findFirst({
        where: {
          tokenHash: requireFilterValue(tokenHash, "tokenHash"),
          usedAt: { isNull: true },
        },
        columns: { id: true, identifier: true, userId: true, expires: true },
      });
    } catch (error) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /** The email-verification token stored for `token`, if any. */
  private async findVerificationToken(
    token: string
  ): Promise<StoredTokenRow | undefined> {
    const tokenHash = storedTokenHash(token);
    try {
      return await this.db.query.emailVerificationTokens.findFirst({
        where: { tokenHash: requireFilterValue(tokenHash, "tokenHash") },
        columns: { id: true, identifier: true, userId: true, expires: true },
      });
    } catch (error) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /** The unused invite stored for `token`, if any. */
  private async findUnusedInviteToken(
    token: string
  ): Promise<{ id: number; userId: string; expires: Date } | undefined> {
    const tokenHash = hashInviteToken(token);
    try {
      return await this.db.query.userInviteTokens.findFirst({
        // rqb v2 object filter (drizzle v1): unused invite for this hash.
        where: { tokenHash, usedAt: { isNull: true } },
        columns: { id: true, userId: true, expires: true },
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();

    try {
      await this.db
        .delete(this.tables.passwordResetTokens)
        .where(lt(this.tables.passwordResetTokens.expires, now));

      await this.db
        .delete(this.tables.emailVerificationTokens)
        .where(lt(this.tables.emailVerificationTokens.expires, now));

      await this.db
        .delete(this.tables.userInviteTokens)
        .where(lt(this.tables.userInviteTokens.expires, now));
    } catch (error) {
      this.logger.error("Failed to cleanup expired tokens", { error: error });
    }
  }
}
