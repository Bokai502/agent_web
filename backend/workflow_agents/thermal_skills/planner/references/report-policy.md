# Report Policy

Any user request that includes report generation, report regeneration, report
summary, report review, "输出报告", "生成报告", "重新生成报告", or a full
CAD/thermal workflow ending in a report must include the Reviewer stage using
`cad-sim-report-agent`.

If the user asks only to summarize, review, inspect, or regenerate an existing
report, hand off directly to `cad-sim-report-agent`. Do not select CAD or
simulation executor skills unless the user also asks to rerun upstream
artifacts.

`cad-sim-report-agent` may generate a final report after CAD validation
`success == true` and simulation passes. CAD validation warnings must be
reported as residual geometry risk, not treated as a failed gate.

When final chat output or a report summary includes CAD validation warnings, ask
the user whether they want to enter a CAD/layout modification step to resolve
those warnings.

If the debug loop reaches 3 failed attempts, generate only a failure report from
the latest failing artifacts.

Do not label a failed CAD or simulation run as a completed final engineering
result.

Planner, Config Editor, CAD executors, CAD debug/status helpers, and Simulation
executor must not hand-write Markdown or JSON report files as a substitute for
`cad-sim-report-agent`. They may only report transient status in chat.
