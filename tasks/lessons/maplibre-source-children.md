# Preserve third-party child-injection contracts

## Failure pattern

`react-map-gl` `Source` binds a layer by cloning each immediate child with a
`source` prop. Extracting those `Layer` elements behind a custom component
discarded the injected prop. JSX/component tests stayed green because their
`Source` mock only rendered children and therefore omitted the production
contract that was broken.

## Preventive rule

- Before extracting children from a third-party container, inspect whether the
  container injects props, context, ordering, refs, or lifecycle through its
  immediate children.
- Keep `Layer` directly below `Source`; if a wrapper is unavoidable, forward
  `source` explicitly.
- Make the test double reproduce the relevant third-party behavior. Rendering
  children unchanged is insufficient when production clones or transforms them.
- A refactor is not behavior-preserving until the owning integration contract
  has a red-before/green-after regression test.
