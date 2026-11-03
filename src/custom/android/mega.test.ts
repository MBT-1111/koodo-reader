import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ value: null as string | null, command: vi.fn(), closed: vi.fn() }));
vi.mock("./storage", () => ({ nativeCommand: async (request: { action: string; value?: string }) => {
  fixture.command(request);
  if (request.action === "read") return fixture.value;
  if (request.action === "write") fixture.value = request.value!;
  if (request.action === "remove") fixture.value = null;
} }));
vi.mock("megajs", () => ({ Storage: class {
  ready = Promise.resolve(this);
  api = { request: async () => ({}), close: fixture.closed };
  constructor(private options: Record<string, unknown>) {}
  on() {}
  toJSON() { return { key: "synthetic-key", sid: "synthetic-session", name: "Fixture", user: "fixture", options: this.options }; }
} }));
import { androidSyncConnection, configureAndroidMega, disconnectAndroidSync, isConnectingMega } from "./mega";
const input = { email: "fixture@example.invalid", password: "test-password-never-persist", secondFactorCode: "123456", namespace: "unit", autoMinutes: 0 };
beforeEach(() => { fixture.value = null; vi.clearAllMocks(); });
describe("Android MEGA connection persistence", () => {
  it("saves only a session in the native credential slot and removes password and OTP", async () => {
    await configureAndroidMega(input);
    const saved = JSON.parse(fixture.value!);
    expect(saved.session.options.password).toBeUndefined();
    expect(saved.session.options.secondFactorCode).toBeUndefined();
    expect(saved.session.options.fetch).toBeUndefined();
    expect(fixture.value!.includes(input.password)).toBe(false);
    expect(fixture.value!.includes(input.secondFactorCode)).toBe(false);
    expect(fixture.command.mock.calls.some(([request]) => request.channel !== "credential")).toBe(false);
    expect(fixture.closed).toHaveBeenCalledOnce(); expect(isConnectingMega()).toBe(false);
    expect(await androidSyncConnection()).toEqual({ email: input.email, namespace: "unit", autoMinutes: 0, scope: saved.scope });
  });
  it("reuses a saved session for namespace changes without retaining or asking again for a password", async () => {
    const first = await configureAndroidMega(input);
    const second = await configureAndroidMega({ ...input, password: "", secondFactorCode: "", namespace: "other", autoMinutes: 5 });
    expect(second.scope).not.toBe(first.scope); expect(fixture.closed).toHaveBeenCalledOnce();
    await disconnectAndroidSync(); expect(await androidSyncConnection()).toBeNull();
  });
  it("rejects invalid connection settings before reading or changing native credentials", async () => {
    await expect(configureAndroidMega({ ...input, namespace: "../escape" })).rejects.toThrow("CUSTOM_INVALID_SETTINGS");
    expect(fixture.command).not.toHaveBeenCalled(); expect(isConnectingMega()).toBe(false);
  });
});
