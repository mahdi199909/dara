// A capture is a few calls to the app's own API — "create this task", "then mark that event done" —
// described as data first and run afterwards. That is what lets ONE description of what a line means
// be carried out by the web app (over HTTP, one call after another) and by the phone when the widget's
// queue is drained (through the local dispatcher, all inside one database transaction, which has to be
// synchronous). Each step is a function of the answers to the steps before it (an event's id is only
// known once it exists).
export interface CaptureCall {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
}

export type CaptureStep = (previous: unknown[]) => CaptureCall;

export async function runSteps(steps: CaptureStep[], exec: (call: CaptureCall) => Promise<unknown>): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const step of steps) results.push(await exec(step(results)));
  return results;
}

export function runStepsSync(steps: CaptureStep[], exec: (call: CaptureCall) => unknown): unknown[] {
  const results: unknown[] = [];
  for (const step of steps) results.push(exec(step(results)));
  return results;
}
