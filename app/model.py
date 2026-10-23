"""Explainable logistic risk scoring with preconfigured synthetic-demo coefficients.

Weights are hand configured rather than learned from real machine failures.
Scores are demonstration-only, not calibrated failure probabilities or alarms.
"""
import json
import math
from pathlib import Path

MODEL_PATH = Path(__file__).with_name('model.json')


def features(telemetry):
    """Normalized telemetry features with engineering reference baselines."""
    return {
        'temperature': (float(telemetry['temperature']) - 62) / 18,
        'vibration': (float(telemetry['vibration']) - 2.4) / 1.7,
        'pressure_deviation': abs(float(telemetry['pressure']) - 6.2) / 1.7,
        'current': (float(telemetry['current']) - 18) / 6,
        'rpm_deviation': abs(float(telemetry['rpm']) - 1480) / 240,
    }


def predict(telemetry):
    """Return score [0,100], severity and top explanatory features."""
    model = json.loads(MODEL_PATH.read_text(encoding='utf-8'))
    xs = features(telemetry)
    contributions = {k: round(model['weights'][k] * v, 3) for k, v in xs.items()}
    z = model['intercept'] + sum(contributions.values())
    # Numerically stable logistic; model weights are illustrative, not field trained.
    probability = 1 / (1 + math.exp(-max(-40, min(40, z))))
    score = round(100 * probability)
    severity = 'critical' if score >= 65 else 'warning' if score >= 35 else 'healthy'
    labels = {
        'temperature': 'Elevated temperature', 'vibration': 'Unusual vibration',
        'pressure_deviation': 'Pressure deviation', 'current': 'High power draw',
        'rpm_deviation': 'Speed deviation',
    }
    drivers = [{'factor': labels[k], 'impact': round(v, 2)} for k, v in
               sorted(contributions.items(), key=lambda item: item[1], reverse=True) if v > 0]
    return {'risk': score, 'status': severity, 'drivers': drivers[:3],
            'model': model['version'], 'horizon': '24h (simulated)'}
