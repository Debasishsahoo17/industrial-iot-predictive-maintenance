# PulseCore model card

## Intended use

A **demonstration-only** interpretable risk model to accompany simulated industrial equipment telemetry in a portfolio project.

## Inputs

| Input | Unit | Baseline | Normalization |
| --- | --- | --- | --- |
| Temperature | °C | 62 | `(x−62)/18` |
| Vibration | mm/s | 2.4 | `(x−2.4)/1.7` |
| Pressure | bar | 6.2 | `abs(x−6.2)/1.7` |
| Current | A | 18 | `(x−18)/6` |
| Shaft speed | rpm | 1480 | `abs(x−1480)/240` |

## Method

The model uses `sigmoid(intercept + weighted_features)`, scores 0–100, and returns the largest positive weighted contributors. Coefficients are supplied in `app/model.json` and mirrored in `web/demo-api.js` to run offline. The thresholds are 35 and 65, defining Healthy, Warning and Critical conditions.

## Training, evaluation and limitations

The coefficients are **preconfigured for convincing synthetic test cases**. No observational industrial failure dataset was used and no training, accuracy, precision, recall, ROC-AUC, calibration, or lead-time performance is claimed. The data generator creates trends with wear and stochastic noise; it does not model all machine dynamics, environmental factors or correlated sensor failures. The “next 24 hours” language indicates an illustrative horizon **only**, not a statistically established failure estimate. Higher numerical scores should not be interpreted as real probabilities of physical failure.

## Safety boundary

Do not connect outputs to shutdown logic, production control, maintenance sign-off or safety alarms. Real deployment requires validated field data, data quality checks, domain-specific thresholds, drift monitoring, calibration, protective control logic, access restrictions and review by experienced reliability engineers.
