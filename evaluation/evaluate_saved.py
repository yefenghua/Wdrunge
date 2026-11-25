"""Check archived case evidence without running models or website services."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))

def require(condition, message):
    if not condition:
        raise SystemExit("FAIL: " + message)

def main():
    manifest = read("evaluation/traces/manifest.json")
    for entry in manifest:
        target = (ROOT / entry["path"]).resolve()
        require(target.is_relative_to(ROOT), "invalid manifest path")
        require(hashlib.sha256(target.read_bytes()).hexdigest() == entry["sha256"], entry["path"])
    summary = read("evaluation/results/cases.json")
    for row in summary:
        case = row["case"]
        prefix = "evaluation/traces/" + case + "/"
        metrics = read(prefix + "metrics.json")
        acceptance = read(prefix + "acceptance.json")
        usage = metrics["usage"]["totals"]
        require(usage["input_tokens"] + usage["output_tokens"] == usage["total_tokens"], case + " token total")
        require(row["total_tokens"] == usage["total_tokens"], case + " summary tokens")
        require(row["model_calls"] == usage["calls"], case + " summary model calls")
        require(row["tool_calls"] == metrics["usage"]["tool_calls"], case + " summary tool calls")
        require(row["formal_reworks"] == metrics.get("formal_reworks", metrics.get("reworks")), case + " reworks")
        require(row["final_acceptance_seconds"] == metrics["final_acceptance_seconds"], case + " duration")
        require(row["functional_success"] == metrics.get("functional_success", metrics.get("final_success")), case + " functional outcome")
        require(row["overall_run_success"] == metrics.get("overall_run_success", metrics.get("final_success")), case + " overall outcome")
        require(acceptance["all_passed"] is True, case + " functional acceptance")
        if case == "R1":
            require(acceptance["passed"] == acceptance["total"] == 20, "R1 checks")
            docs = read(prefix + "documentation-check.json")
            require(not docs["first_delivery"]["passed"] and docs["rework_candidate"]["passed"], "R1 startup correction")
        else:
            require(len(acceptance["groups"]) == 4 and all(g["passed"] for g in acceptance["groups"]), case + " acceptance groups")
        if case == "R3":
            require(metrics["overall_run_success"] is False and metrics["scope_control_passed"] is False, "R3 failure classification")
            anomaly = read(prefix + "scope-anomaly.json")
            request = anomaly["request"]
            require(request["id"] == "leader:r4-backend-markdown", "R3 extra task")
            require(request["state"] == "cancelled" and request["workspace_published"] is False and not request["delivered"], "R3 cancellation")
            require(anomaly["excluded_from_delivery"] is True, "R3 delivery exclusion")
            require(read(prefix + "execution-closed.json")["running"] is False, "R3 execution closed")
            print("PASS R3: recorded scope-control failure and cancellation confirmed")
        else:
            print("PASS " + case + ": recorded functional outcome confirmed")
    print("PASS: " + str(len(manifest)) + " imported file hashes verified; no live experiments run")

if __name__ == "__main__":
    main()
