export type {
  EmailProvider,
  SmtpConfig,
  ResendConfig,
  SendLayerConfig,
  EmailTemplateFn,
  EmailConfig,
  EmailProviderAdapter,
} from "../../domains/email/types";

export { EmailService } from "../../domains/email/services/email-service";

export { EmailProviderService } from "../../domains/email/services/email-provider-service";
export type {
  CreateEmailProviderInput,
  UpdateEmailProviderInput,
} from "../../domains/email/services/email-provider-service";

export { EmailTemplateService } from "../../domains/email/services/email-template-service";
export type {
  CreateEmailTemplateInput,
  UpdateEmailTemplateInput,
} from "../../domains/email/services/email-template-service";

export {
  escapeHtml,
  resolveVariable,
  interpolateTemplate,
  validateTemplateVariables,
  interpolateWithValidation,
} from "../../domains/email/services/template-engine";
export type {
  InterpolateOptions,
  TemplateValidationResult,
} from "../../domains/email/services/template-engine";

export { createSmtpProvider } from "../../domains/email/services/providers/smtp-provider";
export { createResendProvider } from "../../domains/email/services/providers/resend-provider";
export { createSendLayerProvider } from "../../domains/email/services/providers/sendlayer-provider";
