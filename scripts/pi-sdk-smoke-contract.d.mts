export type RpcRow = {
  id?: string;
  type?: string;
  method?: string;
  message?: string;
  notifyType?: string;
  success?: boolean;
  data?: {
    commands?: Array<{ name: string }>;
    disposition?: string;
  };
};

export type SmokeAssertion = {
  id: string;
  expected: string;
  observed: string;
  passed: boolean;
};

export type BehaviorInput = {
  inventory?: RpcRow;
  prompt?: RpcRow;
  notification?: RpcRow;
  agentEvents?: unknown[];
  exit_code?: number;
  process_exited?: boolean;
  unhandled_error?: boolean;
  extension_load_error?: boolean;
  shell_stdout?: string;
  shell_stderr?: string;
  expectedVersion?: string;
  featureArtifact?: {
    valid: boolean;
    sourceRequestCount: number;
    id?: string;
    primarySkill?: string;
    sourceUrl?: string;
  };
};

export const VERIFICATION_CONTRACT: "pi-sdk-behavior-v2";
export const SDK_VERSIONS: Readonly<Record<string, "1.1.0">>;
export const UNHANDLED_ERROR_PATTERN: RegExp;
export const EXTENSION_LOAD_ERROR_PATTERN: RegExp;
export function parseJsonLines(output: string): unknown[];
export function behaviorAssertions(name: string, input: BehaviorInput): SmokeAssertion[];
