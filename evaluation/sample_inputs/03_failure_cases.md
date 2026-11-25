# R3: Failure case

Task: add categories and filtering to the base guestbook using serial backend/frontend implementation, then stop after delivery.

After one functional rework, the website passed acceptance. The Leader then created an unrequested Markdown extension task, exceeding the requested scope. The operator stopped execution. The extra task was cancelled and its changes were not published.

Result: functional acceptance passed, but scope control failed and overall_run_success is false. The run recorded 2,487,880 tokens, including 138,877 tokens directly attributed to the extra task.

- [Original input](../traces/R3/original-input.txt)
- [Metrics](../traces/R3/metrics.json)
- [Scope violation and cancellation](../traces/R3/scope-anomaly.json)
- [Closed execution state](../traces/R3/execution-closed.json)
- [Functional acceptance](../traces/R3/acceptance.json)

R3 is the original run, separate from the R3b scheduling experiment.
