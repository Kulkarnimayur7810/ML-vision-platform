/** Starting structures only. They contain prompts, never invented results or numbers. */
export type DocKind = "blank" | "meeting" | "collection" | "labeling" | "experiment" | "model_card" | "report";
export const TEMPLATES: { kind: DocKind; label: string; help: string; title: string; body: string }[] = [
  { kind: "blank", label: "Blank page", help: "Start from nothing.", title: "Untitled", body: "" },
  { kind: "meeting", label: "Meeting notes", help: "Decisions and who does what next.", title: "Meeting notes", body: `# Meeting notes

**Date:** 
**Attendees:** 

## Agenda
- 

## Decisions
- 

## Action items
- [ ] Owner — what — by when
` },
  { kind: "collection", label: "Data collection protocol", help: "How photos are taken so the dataset stays consistent.", title: "Data collection protocol", body: `# Data collection protocol

## Goal
What must the model recognise, and in what setting?

## Setup
Camera, height and angle, lighting, background, belt speed.

## Items and classes
List every class and how many examples you aim for. Include rare or confusing items.

## Capture rules
- One item or several per photo?
- Allowed occlusion and overlap
- Distances and orientations to cover

## Quality checks
Reject blurry, dark or duplicate photos. Note who checks, and how often.

## Log
| Date | Who | What was collected | Notes |
|---|---|---|---|
` },
  { kind: "labeling", label: "Labeling guidelines", help: "Shared rules so everyone draws boxes the same way.", title: "Labeling guidelines", body: `# Labeling guidelines

## Boxes
Draw tight boxes around the visible part of each item. Say how to treat partly hidden and cut-off items.

## Classes
For each class: a definition, 2–3 typical examples, and common look-alikes.

## Edge cases
What to do with unclear, tiny, blurry or overlapping items.

## Review
Who reviews, what counts as "needs fixes", and how feedback is given.
` },
  { kind: "experiment", label: "Experiment report", help: "What was tried and what the evidence says.", title: "Experiment report", body: `# Experiment report

## Question
What are we trying to find out?

## Setup
Dataset version, model, settings, and what changed from the last run.

## Results
Use **Insert run results** to paste real numbers, labelled by split. Do not quote validation scores as final results.

## Interpretation
What do the results show, and what do they not show?

## Next steps
- 
` },
  { kind: "model_card", label: "Model card", help: "What a model is for, how it was tested, and its limits.", title: "Model card", body: `# Model card

## Intended use
What the model should be used for, and what it should not.

## Training data
Dataset and version, number of images per class, known gaps.

## Evaluation
Test-split results (use **Insert run results**) and the conditions they were measured in.

## Limitations
Items, lighting or backgrounds where it is known to fail.

## Maintenance
Who owns it and when it should be re-checked.
` },
  { kind: "report", label: "Project report section", help: "A section for the final-year report.", title: "Report section", body: `# Section title

## Purpose
Why this part of the project exists.

## Method
What was done, with enough detail to repeat it.

## Results
Link the runs and datasets below and cite real figures only.

## Discussion
Strengths, weaknesses, and what you would improve.
` },
];
export const templateFor = (k: string) => TEMPLATES.find((t) => t.kind === k) ?? TEMPLATES[0];
