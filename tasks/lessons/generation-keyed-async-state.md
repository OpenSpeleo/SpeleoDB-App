# Hide stale async state by generation, not an effect reset

An async React loader often needs old data to disappear immediately when its
inputs change. Calling `setState(empty)` synchronously inside the effect adds a
render, can cascade when a dependency is unstable, and violates the hook
performance rule.

Store the input generation alongside the loaded data. During render, expose the
data only when its generation matches current inputs. Async callbacks merge into
the matching generation or start a new one, and the effect cleanup still rejects
stale completion. This hides prior data synchronously without an effect-driven
reset render.
