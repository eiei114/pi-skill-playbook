# Run diff dogfood fixtures

Completed-run history pairs used to validate `/playbook:rundiff` output after
real regression dogfood. Each JSON file describes a newer and older completed
run with the expected compact diff signal.

Run with `npm test` (`tests/run-diff.test.ts` loads the regression case inline).

## Layout

```text
tests/fixtures/run-diff/
  README.md
  review-step-regression.json
```

## `review-step-regression.json`

Models a Pi OSS delivery where the `review` step regressed from `pass` to
`fail` between two otherwise identical runs. Dogfood found that naming the step
in change lines and omitting a duplicate final-outcome line keeps the summary
useful without hiding the regression signal.
