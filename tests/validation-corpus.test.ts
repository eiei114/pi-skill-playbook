import assert from "node:assert/strict";
import test from "node:test";
import { validatePlaybook, validateRunState, validateUniquePlaybookIds } from "../src/validation.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

// One valid playbook is the seed for every rejection case below. Each case
// applies a single mutation and pins the exact user-facing message, including
// the `path: ` prefix that real load errors carry.
const PLAYBOOK_PATH = "feature.yml";
const PATH_PREFIX = `${PLAYBOOK_PATH}: `;
const SEED_SKILLS = ["grill-with-docs", "to-prd"];

type Mutable = Record<string, any>;

function seed(): Mutable {
  return {
    version: 1,
    id: "feature-development",
    name: "Feature Development Playbook",
    entry: "grill",
    skills: {
      "grill-with-docs": { role: "entry" },
      "to-prd": { role: "internal" },
    },
    steps: {
      grill: {
        primarySkill: "grill-with-docs",
        commandHint: "/skill:grill-with-docs <feature idea>",
        doneWhen: ["Problem boundary is clear."],
        transitions: [{ outcome: "ready-for-prd", to: "prd" }],
      },
      prd: {
        primarySkill: "to-prd",
        commandHint: "/skill:to-prd create PRD",
        doneWhen: ["PRD exists."],
        transitions: [{ outcome: "done", to: "complete" }],
      },
    },
  };
}

function load(definition: Mutable, path = PLAYBOOK_PATH): LoadedPlaybook {
  return { path, definition: definition as unknown as LoadedPlaybook["definition"] };
}

interface Case {
  name: string;
  mutate: (pb: Mutable) => void;
  requireSkills?: boolean;
  availableSkills?: ReadonlySet<string>;
  expected: string[];
}

const ERROR_CASES: Case[] = [
  {
    name: "wrong version",
    mutate: (pb) => {
      pb.version = 2;
    },
    expected: [`${PATH_PREFIX}version must be 1`],
  },
  {
    name: "missing id",
    mutate: (pb) => {
      delete pb.id;
    },
    expected: [`${PATH_PREFIX}id is required`],
  },
  {
    name: "uppercase id",
    mutate: (pb) => {
      pb.id = "Feature-Development";
    },
    expected: [`${PATH_PREFIX}id must be lower-kebab-case`],
  },
  {
    name: "underscored id",
    mutate: (pb) => {
      pb.id = "feature_development";
    },
    expected: [`${PATH_PREFIX}id must be lower-kebab-case`],
  },
  {
    name: "missing name",
    mutate: (pb) => {
      delete pb.name;
    },
    expected: [`${PATH_PREFIX}name is required`],
  },
  {
    name: "whitespace-only name",
    mutate: (pb) => {
      pb.name = "   ";
    },
    expected: [`${PATH_PREFIX}name is required`],
  },
  {
    name: "missing entry",
    mutate: (pb) => {
      delete pb.entry;
    },
    expected: [`${PATH_PREFIX}entry is required`],
  },
  {
    name: "entry points at a missing step",
    mutate: (pb) => {
      pb.entry = "missing-step";
    },
    expected: [`${PATH_PREFIX}entry step 'missing-step' is missing`],
  },
  {
    // Object prototype keys must not satisfy `entry`.
    name: "entry uses an inherited property name",
    mutate: (pb) => {
      pb.entry = "toString";
    },
    expected: [`${PATH_PREFIX}entry step 'toString' is missing`],
  },
  {
    name: "non-object skills map",
    mutate: (pb) => {
      pb.skills = "not-a-map";
    },
    expected: [
      `${PATH_PREFIX}skills map is required`,
      `${PATH_PREFIX}steps.grill.primarySkill 'grill-with-docs' is not declared in skills`,
      `${PATH_PREFIX}steps.prd.primarySkill 'to-prd' is not declared in skills`,
    ],
  },
  {
    name: "missing skills map",
    mutate: (pb) => {
      delete pb.skills;
    },
    expected: [
      `${PATH_PREFIX}skills map is required`,
      `${PATH_PREFIX}steps.grill.primarySkill 'grill-with-docs' is not declared in skills`,
      `${PATH_PREFIX}steps.prd.primarySkill 'to-prd' is not declared in skills`,
    ],
  },
  {
    name: "non-object steps map",
    mutate: (pb) => {
      pb.steps = ["grill"];
    },
    expected: [`${PATH_PREFIX}steps map is required`],
  },
  {
    name: "unsupported skill role",
    mutate: (pb) => {
      pb.skills["grill-with-docs"].role = "primary";
    },
    expected: [`${PATH_PREFIX}skills.grill-with-docs.role must be 'entry' or 'internal'`],
  },
  {
    name: "skill entry that is not an object",
    mutate: (pb) => {
      pb.skills["to-prd"] = "internal";
    },
    expected: [`${PATH_PREFIX}skills.to-prd must be an object`],
  },
  {
    name: "step id is not lower-kebab-case",
    mutate: (pb) => {
      pb.steps["grill_docs"] = pb.steps.grill;
      delete pb.steps.grill;
      pb.entry = "grill_docs";
    },
    expected: [`${PATH_PREFIX}step 'grill_docs' must be lower-kebab-case`],
  },
  {
    name: "step entry that is not an object",
    mutate: (pb) => {
      pb.steps.prd = "to-prd";
    },
    expected: [`${PATH_PREFIX}steps.prd must be an object`],
  },
  {
    name: "missing primarySkill",
    mutate: (pb) => {
      delete pb.steps.grill.primarySkill;
    },
    expected: [`${PATH_PREFIX}steps.grill.primarySkill is required`],
  },
  {
    name: "primarySkill not declared in skills",
    mutate: (pb) => {
      pb.steps.grill.primarySkill = "not-declared";
    },
    expected: [`${PATH_PREFIX}steps.grill.primarySkill 'not-declared' is not declared in skills`],
  },
  {
    // Object prototype keys must not satisfy a declared skill.
    name: "primarySkill uses an inherited property name",
    mutate: (pb) => {
      pb.steps.grill.primarySkill = "constructor";
    },
    expected: [`${PATH_PREFIX}steps.grill.primarySkill 'constructor' is not declared in skills`],
  },
  {
    name: "primarySkill not available on this host",
    mutate: () => {},
    requireSkills: true,
    availableSkills: new Set(["grill-with-docs"]),
    expected: [`${PATH_PREFIX}steps.prd.primarySkill 'to-prd' is not an available Agent Skill`],
  },
  {
    name: "missing commandHint",
    mutate: (pb) => {
      delete pb.steps.prd.commandHint;
    },
    expected: [`${PATH_PREFIX}steps.prd.commandHint is required`],
  },
  {
    name: "empty doneWhen array",
    mutate: (pb) => {
      pb.steps.prd.doneWhen = [];
    },
    expected: [`${PATH_PREFIX}steps.prd.doneWhen must be a non-empty string array`],
  },
  {
    name: "non-array doneWhen",
    mutate: (pb) => {
      pb.steps.prd.doneWhen = "PRD exists.";
    },
    expected: [`${PATH_PREFIX}steps.prd.doneWhen must be a non-empty string array`],
  },
  {
    name: "doneWhen containing a blank string",
    mutate: (pb) => {
      pb.steps.prd.doneWhen = ["PRD exists.", "  "];
    },
    expected: [`${PATH_PREFIX}steps.prd.doneWhen must be a non-empty string array`],
  },
  {
    name: "doneWhen containing a non-string",
    mutate: (pb) => {
      pb.steps.prd.doneWhen = [1];
    },
    expected: [`${PATH_PREFIX}steps.prd.doneWhen must be a non-empty string array`],
  },
  {
    name: "non-array transitions",
    mutate: (pb) => {
      pb.steps.grill.transitions = { outcome: "ready-for-prd", to: "prd" };
    },
    expected: [`${PATH_PREFIX}steps.grill.transitions must be an array`],
  },
  {
    name: "non-object transition",
    mutate: (pb) => {
      pb.steps.grill.transitions = ["ready-for-prd"];
    },
    expected: [`${PATH_PREFIX}steps.grill.transitions contains a non-object transition`],
  },
  {
    name: "transition without outcome",
    mutate: (pb) => {
      pb.steps.grill.transitions = [{ to: "prd" }];
    },
    expected: [`${PATH_PREFIX}steps.grill.transition.outcome is required`],
  },
  {
    name: "duplicated transition outcome",
    mutate: (pb) => {
      pb.steps.grill.transitions = [
        { outcome: "ready-for-prd", to: "prd" },
        { outcome: "ready-for-prd", to: "complete" },
      ];
    },
    expected: [`${PATH_PREFIX}steps.grill.transition outcome 'ready-for-prd' is duplicated`],
  },
  {
    name: "transition without to",
    mutate: (pb) => {
      pb.steps.grill.transitions = [{ outcome: "ready-for-prd" }];
    },
    expected: [`${PATH_PREFIX}steps.grill.transition.to is required`],
  },
  {
    name: "transition targets a missing step",
    mutate: (pb) => {
      pb.steps.grill.transitions = [{ outcome: "ready-for-prd", to: "nope" }];
    },
    expected: [`${PATH_PREFIX}steps.grill.transition 'ready-for-prd' targets missing step 'nope'`],
  },
  {
    // Object prototype keys must not become valid transition targets.
    name: "transition targets an inherited property name",
    mutate: (pb) => {
      pb.steps.grill.transitions = [{ outcome: "ready-for-prd", to: "valueOf" }];
    },
    expected: [`${PATH_PREFIX}steps.grill.transition 'ready-for-prd' targets missing step 'valueOf'`],
  },
  {
    name: "unsupported autoAdvance mode",
    mutate: (pb) => {
      pb.autoAdvance = "always";
    },
    expected: [`${PATH_PREFIX}autoAdvance must be 'auto', 'suggest', or 'off'`],
  },
];

test("the seed playbook is valid, so every corpus case fails only because of its mutation", () => {
  const result = validatePlaybook(load(seed()), new Set(SEED_SKILLS), { requireSkills: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

for (const testCase of ERROR_CASES) {
  test(`rejects ${testCase.name}`, () => {
    const definition = seed();
    testCase.mutate(definition);
    const result = validatePlaybook(
      load(definition),
      testCase.availableSkills ?? new Set(SEED_SKILLS),
      { requireSkills: testCase.requireSkills ?? false },
    );
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, testCase.expected);
  });
}

test("non-kebab-case skill names stay warnings, not errors", () => {
  const definition = seed();
  definition.skills.My_Skill = { role: "internal" };
  const result = validatePlaybook(load(definition));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [`${PATH_PREFIX}skill 'My_Skill' is not lower-kebab-case`]);
});

test("warnings do not block a valid playbook", () => {
  const definition = seed();
  definition.skills.My_Skill = { role: "internal" };
  const result = validatePlaybook(load(definition), new Set(SEED_SKILLS), { requireSkills: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects duplicate playbook ids across files", () => {
  const first = load(seed(), "a.yml");
  const second = load(seed(), "b.yml");
  const result = validateUniquePlaybookIds([first, second]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [`duplicate playbook id 'feature-development' in a.yml and b.yml`]);
});

test("accepts unique playbook ids across files", () => {
  const first = load(seed(), "a.yml");
  const second = seed();
  second.id = "second-playbook";
  const result = validateUniquePlaybookIds([first, load(second, "b.yml")]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

function runState(overrides: Partial<PlaybookRunState> = {}): PlaybookRunState {
  return {
    runId: "run-1",
    playbookId: "feature-development",
    playbookPath: PLAYBOOK_PATH,
    currentStep: "grill",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    history: [],
    ...overrides,
  };
}

test("rejects a run that references a missing playbook", () => {
  const errors = validateRunState(undefined, runState({ playbookId: "ghost-playbook" }));
  assert.deepEqual(errors, [`run 'run-1' references missing playbook 'ghost-playbook'`]);
});

test("rejects a run that points at a missing step", () => {
  const errors = validateRunState(load(seed()), runState({ currentStep: "ghost-step" }));
  assert.deepEqual(errors, [`run 'run-1' points to missing step 'ghost-step'`]);
});

test("rejects a run whose current step is an inherited property name", () => {
  const errors = validateRunState(load(seed()), runState({ currentStep: "toString" }));
  assert.deepEqual(errors, [`run 'run-1' points to missing step 'toString'`]);
});

test("accepts a run on a real step and a completed run on a missing step", () => {
  assert.deepEqual(validateRunState(load(seed()), runState()), []);
  assert.deepEqual(validateRunState(load(seed()), runState({ currentStep: "ghost-step", status: "completed" })), []);
});

test("run validation does not crash when the playbook steps map is missing", () => {
  const definition = seed();
  delete definition.steps;
  assert.deepEqual(validateRunState(load(definition), runState()), [
    `run 'run-1' points to missing step 'grill'`,
  ]);
});
