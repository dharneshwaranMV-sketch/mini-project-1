from flask import Flask, request, jsonify
import json
import os
import urllib.request

app = Flask(__name__)

# Thresholds — authoritative for the whole system (Flask + Node + browser).
TEMP_WARNING = 55.0
TEMP_FAULT = 65.0

VIB_WARNING = 2500
VIB_FAULT = 3500

# Node dashboard server that persists readings and live-broadcasts them to
# browsers over WebSocket. Overridable so app.py can run on a different host.
NODE_DASHBOARD_URL = os.getenv("NODE_DASHBOARD_URL", "http://localhost:5000").rstrip("/")

# Device id used when the ESP32 does not include one in its payload.
DEFAULT_DEVICE_ID = os.getenv("MOTOR_DEVICE_ID", "MOTOR_BOT_01")


def process_motor_data(temperature, vibration):
    # Boundary semantics: >= WARNING threshold -> WARNING, >= FAULT -> FAULT.
    if temperature >= TEMP_FAULT or vibration >= VIB_FAULT:
        status = "FAULT"
    elif temperature >= TEMP_WARNING or vibration >= VIB_WARNING:
        status = "WARNING"
    else:
        status = "HEALTHY"

    return {
        "temperature": round(temperature, 1),
        "vibration": vibration,
        "status": status,
    }


def forward_to_dashboard(payload):
    """POST a validated reading to the Node dashboard backend so it can
    persist it to MongoDB and broadcast it live to browsers over WebSocket.

    Forward failures are non-fatal: the ESP32 still gets its classification
    response even if the dashboard server is temporarily down.
    """
    url = NODE_DASHBOARD_URL + "/api/sensor/data"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status
    except Exception as error:
        print("Forward to dashboard failed:", error)
        return None


@app.route("/motor-data", methods=["POST"])
def motor_data():
    try:
        data = request.get_json() or {}

        temperature = float(data["temperature"])
        vibration = int(data["vibration"])

        result = process_motor_data(temperature, vibration)

        # Send the reading to the Node dashboard backend (persist + broadcast).
        forward_to_dashboard({
            "deviceId": (data.get("deviceId") or DEFAULT_DEVICE_ID),
            "temperature": result["temperature"],
            "vibration": result["vibration"],
            "espSignalStrength": data.get("espSignalStrength"),
            "deviceName": data.get("deviceName"),
            "macAddress": data.get("macAddress"),
            "firmwareVersion": data.get("firmwareVersion"),
        })

        print("Received Data:", data)
        print("Processed Result:", result)

        return jsonify(result)

    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/", methods=["GET"])
def home():
    return "Motor Inspection Python Backend Running"


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5001,
        debug=False
    )