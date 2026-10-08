export interface ToolContext {
  conversationId: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolArgs = Record<string, any>;

export interface VectorTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments */
  parameters: Record<string, unknown>;
  /**
   * Return a one-line human summary if this particular call must be approved
   * by Sir before it runs (sending, deleting, overwriting); null otherwise.
   */
  needsConfirmation?: (args: ToolArgs) => string | null | Promise<string | null>;
  run: (args: ToolArgs, ctx: ToolContext) => unknown | Promise<unknown>;
}

/** Thrown by tools for expected failures; the message is shown to the model. */
export class ToolError extends Error {}
