// Test-only stand-in for the browser cookie jar that next/headers' cookies() reads from — see
// syncHarness.ts. Each test file mocks "next/headers" so cookies() delegates here; the harness
// then swaps the jar's value per simulated client (web session vs. the phone's bearer-token calls).
export const cookieJar = {
  value: undefined as string | undefined,
  get(name: string) {
    return this.value ? { name, value: this.value } : undefined;
  },
  set(_name: string, value: string) {
    this.value = value || undefined;
  },
};
