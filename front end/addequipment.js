// Security Check: Ensure Admin Access
function checkAdminAccess() {
    const savedUser = sessionStorage.getItem("lemsUser");

    if (!savedUser) {
        alert("Please log in first.");
        window.location.href = "index.html";
        return false;
    }

    try {
        const user = JSON.parse(savedUser);
        const role = String(user.role || "").toLowerCase();

        if (role !== "admin") {
            alert("Access Denied: Administrator privileges required.");
            window.location.href = "dashboard.html";
            return false;
        }
        return true;
    } catch (e) {
        alert("Session invalid. Please log in again.");
        window.location.href = "index.html";
        return false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    checkAdminAccess();
});

const equipmentForm = document.getElementById("equipmentForm");
const message = document.getElementById("message");
const submitButton = document.getElementById("submitButton");

if (equipmentForm) {
    equipmentForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!checkAdminAccess()) return;

        message.textContent = "Adding equipment...";
        message.style.color = "#173b70";
        submitButton.disabled = true;

        const equipment = {
            equipment_code: document.getElementById("equipment_code").value.trim(),
            name: document.getElementById("name").value.trim(),
            category: document.getElementById("category").value.trim(),
            rfid_tag: document.getElementById("rfid_tag").value.trim(),
            calibration_limit: Number(document.getElementById("calibration_limit").value)
        };

        try {
            if (
                !equipment.equipment_code ||
                !equipment.name ||
                !equipment.category ||
                !equipment.rfid_tag
            ) {
                throw new Error("Please fill in all required fields.");
            }

            if (
                !Number.isFinite(equipment.calibration_limit) ||
                equipment.calibration_limit <= 0
            ) {
                throw new Error("Calibration limit must be greater than zero.");
            }

            let response;
            try {
                response = await fetch("http://localhost:3000/api/equipment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(equipment)
                });
            } catch (err) {
                response = await fetch("http://127.0.0.1:3000/api/equipment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(equipment)
                });
            }

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Unable to add equipment.");
            }

            message.textContent = "✅ " + (result.message || "Equipment added successfully!");
            message.style.color = "green";

            equipmentForm.reset();
            document.getElementById("calibration_limit").value = 500;

        } catch (error) {
            console.error("Add equipment error:", error);

            message.textContent = "❌ " + error.message;
            message.style.color = "red";

        } finally {
            submitButton.disabled = false;
        }
    });
}
