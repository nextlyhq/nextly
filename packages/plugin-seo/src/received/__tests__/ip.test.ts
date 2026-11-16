/**
 * What kind of network address an IP is: the one answer the page check reads
 * before it connects anywhere.
 */
import { describe, expect, it } from "vitest";

import { kindOfIp } from "../ip";

describe("the kind of an IP address", () => {
  it.each([
    ["93.184.216.34", "public"],
    ["8.8.8.8", "public"],
    ["2606:4700:4700::1111", "public"],
    ["2a00:1450:4009:81f::200e", "public"],
  ])("%s is public", (ip, kind) => {
    expect(kindOfIp(ip)).toBe(kind);
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["::1", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback"],
    // An IPv4 address written as IPv6 is the IPv4 address it carries.
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
  ])("%s is loopback", (ip, kind) => {
    expect(kindOfIp(ip)).toBe(kind);
  });

  it.each([
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.10", "private"],
    ["100.64.0.1", "private"],
    ["fc00::1", "private"],
    ["fd12:3456::1", "private"],
    ["::ffff:10.1.2.3", "private"],
  ])("%s is private", (ip, kind) => {
    expect(kindOfIp(ip)).toBe(kind);
  });

  it.each([
    ["169.254.169.254", "link-local"],
    ["169.254.0.1", "link-local"],
    ["fe80::1", "link-local"],
    ["fe80::1%en0", "link-local"],
    ["::ffff:169.254.169.254", "link-local"],
  ])("%s is link-local", (ip, kind) => {
    expect(kindOfIp(ip)).toBe(kind);
  });

  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "192.0.0.8",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "ff02::1",
    "2001:db8::1",
    // Addresses that carry another address inside them, which could be a
    // private one: 6to4, Teredo and NAT64.
    "2002:7f00:1::1",
    "2001:0:4136:e378::1",
    "64:ff9b::7f00:1",
    "fec0::1",
    "100::1",
  ])("%s is reserved", ip => {
    expect(kindOfIp(ip)).toBe("reserved");
  });

  it.each([
    "",
    "localhost",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "::g",
    "1::2::3",
  ])("%s is no IP address", value => {
    expect(kindOfIp(value)).toBeUndefined();
  });
});
