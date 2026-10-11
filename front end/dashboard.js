// Helper function to safely set element text without throwing errors if an element is missing
function setElementText(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    }
}

// Display logged in student information
const savedUser = sessionStorage.getItem("lemsUser");
let currentUser = null;

if (savedUser) {
    try {
        currentUser = JSON.parse(savedUser);
        if (currentUser && currentUser.name && currentUser.student_id) {
            setElementText("studentInfo", `Welcome, ${currentUser.name} (${currentUser.student_id})`);
        }
    } catch (e) {
        console.error("Error parsing savedUser:", e);
    }
}

async function loadEquipment() {
    const table = document.getElementById("equipmentTable");
    if (!table) return;

    try {
        table.innerHTML = `
            <tr>
                <td colspan="7">Loading equipment...</td>
            </tr>
        `;

        let response;
        try {
            response = await fetch("http://localhost:3000/api/equipment");
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/equipment");
        }

        if (!response.ok) {
            throw new Error("Server error: " + response.status);
        }

        const equipment = await response.json();

        // Fetch active checkouts for the currently logged-in user
        let activeTxs = [];
        if (currentUser && currentUser.user_id) {
            try {
                let txRes;
                try {
                    txRes = await fetch(`http://localhost:3000/api/transactions/user/${currentUser.user_id}`);
                } catch (e) {
                    txRes = await fetch(`http://127.0.0.1:3000/api/transactions/user/${currentUser.user_id}`);
                }
                if (txRes.ok) {
                    activeTxs = await txRes.json();
                }
            } catch (e) {
                console.error("Failed to load user active transactions:", e);
            }
        }
        const checkedOutEquipmentIds = new Set(activeTxs.map(t => t.equipment_id));

        const availableCount = equipment.reduce((sum, item) => sum + (item.available_quantity ?? 50), 0);
        const totalCount = equipment.reduce((sum, item) => sum + (item.total_quantity ?? 50), 0);

        // Safely update dashboard summary counts
        setElementText("totalEquipment", totalCount);
        setElementText("availableEquipment", availableCount);
        setElementText("inUseEquipment", totalCount - availableCount);
        setElementText("maintenanceEquipment", equipment.filter(item => item.status === "MAINTENANCE").length);
        setElementText("availableStockText", availableCount);
        setElementText("totalStockText", totalCount);

        // Display equipment table
        if (!equipment || equipment.length === 0) {
            table.innerHTML = `
                <tr>
                    <td colspan="7">No equipment found.</td>
                </tr>
            `;
            return;
        }

        table.innerHTML = equipment.map(item => {
            const avail = item.available_quantity ?? 50;
            const total = item.total_quantity ?? 50;
            const eqStatus = item.status;
            const userHasCheckedOut = checkedOutEquipmentIds.has(item.equipment_id);

            let displayStatus = eqStatus;
            if (eqStatus !== "MAINTENANCE" && eqStatus !== "LOST") {
                displayStatus = userHasCheckedOut ? "IN_USE" : (avail > 0 ? "AVAILABLE" : "OUT_OF_STOCK");
            }

            const badgeClass = displayStatus.toLowerCase();

            return `
                <tr>
                    <td>${item.equipment_code}</td>
                    <td>${item.name}</td>
                    <td>${item.category || "-"}</td>
                    <td><strong>${avail}</strong> / ${total}</td>
                    <td>
                        <span class="status ${badgeClass}">
                            ${userHasCheckedOut ? "IN_USE (You)" : displayStatus}
                        </span>
                    </td>
                    <td>${item.runtime_hours ?? 0}</td>
                    <td>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${
                                userHasCheckedOut
                                    ? `<button onclick="returnEquipment(${item.equipment_id})" style="margin-top:0; background:#b91c1c;">RETURN</button>`
                                    : displayStatus === "AVAILABLE" && avail > 0
                                        ? `<button onclick="checkoutEquipment(${item.equipment_id})" style="margin-top:0;">CHECKOUT</button>`
                                        : displayStatus === "OUT_OF_STOCK"
                                            ? `<span>Out of Stock</span>`
                                            : `<span>Under Maintenance</span>`
                            }
                            <button onclick="reportComplaint(${item.equipment_id})" style="background: #d97706; margin-top:0;">Report Issue</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Equipment loading failed:", error);

        table.innerHTML = `
            <tr>
                <td colspan="7">
                    Failed to load equipment: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Search equipment
function searchEquipment() {
    const searchBox = document.getElementById("searchBox");
    if (!searchBox) return;

    const searchText = searchBox.value.toLowerCase();

    document.querySelectorAll("#equipmentTable tr").forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(searchText)
            ? ""
            : "none";
    });
}

// Checkout equipment
async function checkoutEquipment(equipmentId) {
    if (!currentUser || !currentUser.user_id) {
        alert("Please log in first.");
        window.location.href = "index.html";
        return;
    }

    if (!confirm("Do you want to checkout this equipment?")) {
        return;
    }

    try {
        let response;
        try {
            response = await fetch("http://localhost:3000/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: currentUser.user_id, equipment_id: equipmentId })
            });
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: currentUser.user_id, equipment_id: equipmentId })
            });
        }

        const data = await response.json();

        if (response.ok) {
            alert(data.message || "Equipment checked out successfully!");
            await loadEquipment();
        } else {
            alert(data.message || "Checkout failed");
        }

    } catch (error) {
        console.error("Checkout failed:", error);
        alert("Cannot connect to LEMS server.");
    }
}

// Return equipment
async function returnEquipment(equipmentId) {
    if (!confirm("Are you sure you want to return this equipment?")) {
        return;
    }

    try {
        let response;
        try {
            response = await fetch("http://localhost:3000/api/return", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ equipment_id: equipmentId })
            });
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/return", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ equipment_id: equipmentId })
            });
        }

        const data = await response.json();

        if (response.ok) {
            alert(data.message || "Equipment returned successfully!");
            await loadEquipment();
        } else {
            alert(data.message || "Return failed");
        }

    } catch (error) {
        console.error("Return failed:", error);
        alert("Cannot connect to server.");
    }
}

// Report Maintenance Issue / Complaint
async function reportComplaint(equipmentId) {
    if (!currentUser || !currentUser.user_id) {
        alert("Please log in first.");
        window.location.href = "index.html";
        return;
    }

    const issueDescription = prompt("Describe the maintenance issue or damage with this equipment:");
    if (!issueDescription || !issueDescription.trim()) {
        return;
    }

    try {
        let response;
        try {
            response = await fetch("http://localhost:3000/api/complaints", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_id: currentUser.user_id,
                    equipment_id: equipmentId,
                    issue_description: issueDescription.trim()
                })
            });
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/complaints", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_id: currentUser.user_id,
                    equipment_id: equipmentId,
                    issue_description: issueDescription.trim()
                })
            });
        }

        const data = await response.json();

        if (response.ok) {
            alert(data.message || "Complaint submitted successfully!");
            await loadEquipment();
        } else {
            alert(data.message || "Failed to submit complaint.");
        }
    } catch (error) {
        console.error("Complaint submission error:", error);
        alert("Cannot connect to server.");
    }
}

// Load equipment once when the dashboard opens
loadEquipment();
