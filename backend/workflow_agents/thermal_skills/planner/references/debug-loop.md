# Debug Loop

Use this flow when a CAD executor, simulation executor, or validation gate
fails. Limit the loop to 3 attempts.

1. Debugger explains the root cause using file paths and concrete evidence.
2. Debugger gives concrete modification suggestions for Planner.
3. Planner updates the execution plan.
4. `config-editor` applies needed configuration updates and writes
   `00_inputs/config_editor_output.md`.
5. The selected executor reruns from the updated inputs.
6. Stop the loop when the executor succeeds.

If all 3 attempts fail, stop and report the unresolved failure with the latest
failing artifact.

Debugger must not edit configuration files directly. Planner must not edit
configuration files directly.
