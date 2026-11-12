# Refactor candidates

The refactor step runs with the lane green and changes structure, never behavior. If a test has to change, it was not a refactor.

What to look for, in the order it usually pays:

- **Duplication**: the third occurrence earns the extraction, not the second.
- **Long functions**: split into named helpers and keep the tests on the public interface, so the split does not show up in the test file.
- **Shallow modules**: a module whose interface is as large as its implementation is a cost with no payoff. Combine it or deepen it.
- **Feature envy**: logic that reaches into another object's data belongs where the data lives.
- **Primitive obsession**: an id, a currency, or a path that is passed as a bare string everywhere eventually gets passed in the wrong position. A value object or a branded type ends that class of bug.
- **Existing code the new code exposes**: the change that was hard to write usually points at something already there. Fix it in its own commit, not inside the feature.

## What not to do here

Do not add an abstraction the current code does not need; the refactor step is not an exemption from writing the least that works. Do not widen a public interface "while you are in there". Do not rename across files in the same commit as a behavior change, because the diff then hides which is which.

## Checkpoint

Commit at green, before the refactor. A refactor that goes wrong is then one `git restore` away instead of a reconstruction.
