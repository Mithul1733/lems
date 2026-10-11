const API_URL = "http://localhost:3000/api/equipment";

// Security Check: Verify Admin Access
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

// Helper to safely update element text
function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Format date strings
function formatDate(date) {
    if (!date) return "-";
    const formattedString = typeof date === "string" ? date.replace(" ", "T") : date;
    const parsedDate = new Date(formattedString);
    if (isNaN(parsedDate.getTime())) return "-";

    return parsedDate.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
    });
}

// Escape HTML characters
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);
}

// Load Admin Dashboard & Equipment List
async function loadAdminDashboard() {
    if (!checkAdminAccess()) return;

    const tableBody = document.getElementById("equipmentTable");
    const alerts = document.getElementById("alerts");
    const message = document.getElementById("message");

    try {
        let response;
        try {
            response = await fetch(API_URL);
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/equipment");
        }

        if (!response.ok) throw new Error("Could not load equipment list");

        const equipment = await response.json();

        const availableUnits = equipment.reduce((sum, item) => sum + (item.available_quantity ?? 50), 0);
        const totalUnits = equipment.reduce((sum, item) => sum + (item.total_quantity ?? 50), 0);

        setElementText("totalEquipment", equipment.length);
        setElementText("availableEquipment", equipment.filter(e => e.status === "AVAILABLE").length);
        setElementText("inUseEquipment", equipment.filter(e => e.status === "IN_USE" || e.status === "OUT_OF_STOCK").length);
        setElementText("maintenanceEquipment", equipment.filter(e => e.status === "MAINTENANCE").length);
        setElementText("adminAvailableStockText", availableUnits);
        setElementText("adminTotalStockText", totalUnits);

        tableBody.innerHTML = "";

        if (!equipment || equipment.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No equipment found.</td></tr>`;
            return;
        }

        equipment.forEach(item => {
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${escapeHTML(item.equipment_code)}</td>
                <td>${escapeHTML(item.name)}</td>
                <td>${escapeHTML(item.category || "-")}</td>
                <td><strong>${item.available_quantity ?? 50}</strong> / ${item.total_quantity ?? 50}</td>
                <td></td>
                <td>${Number(item.runtime_hours || 0)}</td>
                <td></td>
            `;

            // Status Dropdown Cell (cell index 4)
            const statusCell = row.cells[4];
            const statusSelect = document.createElement("select");
            statusSelect.style.padding = "6px";
            statusSelect.style.borderRadius = "4px";

            ["AVAILABLE", "IN_USE", "OUT_OF_STOCK", "MAINTENANCE", "LOST"].forEach(status => {
                const option = document.createElement("option");
                option.value = status;
                option.textContent = status;
                option.selected = item.status === status;
                statusSelect.appendChild(option);
            });

            statusSelect.addEventListener("change", async () => {
                await updateEquipment(item, { status: statusSelect.value });
            });
            statusCell.appendChild(statusSelect);

            // Edit Action Button Cell (cell index 6)
            const actionCell = row.cells[6];
            const editButton = document.createElement("button");
            editButton.textContent = "Edit";
            editButton.className = "action-btn edit-btn";
            editButton.addEventListener("click", () => editEquipment(item));
            actionCell.appendChild(editButton);

            tableBody.appendChild(row);
        });

        const hasMaintenance = equipment.some(e =>
            e.status === "MAINTENANCE" ||
            Number(e.runtime_hours) >= Number(e.calibration_limit || 500)
        );

        if (alerts) {
            alerts.textContent = hasMaintenance
                ? "⚠️ Warning: Some equipment requires maintenance or calibration limit reached!"
                : "✅ All equipment systems normal. No maintenance alerts.";
        }

        if (message) message.textContent = "";

        // Also load complaints and recent transactions
        loadComplaints();
        loadAdminTransactions();

    } catch (error) {
        console.error("Admin dashboard load error:", error);
        if (message) {
            message.textContent = "Could not load equipment. Please check backend server.";
            message.style.color = "red";
        }
    }
}

// Load Student Maintenance Complaints
async function loadComplaints() {
    const complaintsTable = document.getElementById("complaintsTable");
    if (!complaintsTable) return;

    try {
        let response;
        try {
            response = await fetch("http://localhost:3000/api/complaints");
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/complaints");
        }

        if (!response.ok) throw new Error("Could not load complaints");

        const complaints = await response.json();

        if (!complaints || complaints.length === 0) {
            complaintsTable.innerHTML = `<tr><td colspan="7" style="text-align:center;">No maintenance complaints reported.</td></tr>`;
            return;
        }

        complaintsTable.innerHTML = complaints.map(c => {
            const isResolved = String(c.complaint_status).toUpperCase() === "RESOLVED";
            return `
                <tr>
                    <td>${c.complaint_id}</td>
                    <td>${escapeHTML(c.student_name || "Unknown")} (${escapeHTML(c.student_id || "-")})</td>
                    <td>${escapeHTML(c.equipment_code || "-")} - ${escapeHTML(c.equipment_name || "-")}</td>
                    <td>${escapeHTML(c.issue_description)}</td>
                    <td>${formatDate(c.created_at)}</td>
                    <td>
                        <span style="background:${isResolved ? '#dcfce7':'#fef3c7'}; color:${isResolved ? '#166534':'#92400e'}; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:bold;">
                            ${c.complaint_status}
                        </span>
                    </td>
                    <td>
                        ${
                            !isResolved
                                ? `<button class="action-btn" style="background:#16a34a; color:white;" onclick="resolveComplaint(${c.complaint_id}, ${c.equipment_id})">Resolve & Make Available</button>`
                                : `<span>Resolved</span>`
                        }
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Load complaints error:", error);
        complaintsTable.innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Failed to load complaints.</td></tr>`;
    }
}

// Load Recent Transactions for Admin Dashboard
async function loadAdminTransactions() {
    const txTable = document.getElementById("adminTransactionsTable");
    if (!txTable) return;

    try {
        let response;
        try {
            response = await fetch("http://localhost:3000/api/transactions");
        } catch (err) {
            response = await fetch("http://127.0.0.1:3000/api/transactions");
        }

        if (!response.ok) throw new Error("Could not load transactions");

        const transactions = await response.json();

        if (!transactions || transactions.length === 0) {
            txTable.innerHTML = `<tr><td colspan="7" style="text-align:center;">No transaction records found.</td></tr>`;
            return;
        }

        txTable.innerHTML = transactions.map(t => {
            const rawStatus = t.status || "UNKNOWN";
            const statusClass = rawStatus.toLowerCase().replace(/[\s_]+/g, "-");

            return `
                <tr>
                    <td>${t.transaction_id}</td>
                    <td>${escapeHTML(t.student_name || "-")}</td>
                    <td>${escapeHTML(t.student_id || "-")}</td>
                    <td>${escapeHTML(t.equipment_code || "-")} - ${escapeHTML(t.equipment_name || "-")}</td>
                    <td>${formatDate(t.checkout_time)}</td>
                    <td>${formatDate(t.return_time)}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${rawStatus}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Load admin transactions error:", error);
        txTable.innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Failed to load transactions.</td></tr>`;
    }
}

// Resolve Complaint
async function resolveComplaint(complaintId, equipmentId) {
    if (!confirm("Mark this complaint as resolved and make equipment AVAILABLE?")) {
        return;
    }

    try {
        let response;
        try {
            response = await fetch(`http://localhost:3000/api/complaints/${complaintId}/resolve`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ equipment_id: equipmentId, make_available: true })
            });
        } catch (err) {
            response = await fetch(`http://127.0.0.1:3000/api/complaints/${complaintId}/resolve`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ equipment_id: equipmentId, make_available: true })
            });
        }

        const data = await response.json();

        if (response.ok) {
            alert(data.message || "Complaint resolved successfully!");
            loadComplaints();
            loadAdminDashboard();
        } else {
            alert(data.message || "Failed to resolve complaint.");
        }
    } catch (error) {
        console.error("Resolve error:", error);
        alert("Cannot connect to server.");
    }
}

// Update Equipment API
async function updateEquipment(item, changes) {
    const updated = {
        equipment_code: changes.equipment_code ?? item.equipment_code,
        name: changes.name ?? item.name,
        category: changes.category ?? item.category,
        rfid_tag: changes.rfid_tag ?? item.rfid_tag,
        status: changes.status ?? item.status,
        calibration_limit: changes.calibration_limit ?? item.calibration_limit ?? 500
    };

    try {
        let response;
        try {
            response = await fetch(`${API_URL}/${item.equipment_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated)
            });
        } catch (err) {
            response = await fetch(`http://127.0.0.1:3000/api/equipment/${item.equipment_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated)
            });
        }

        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Update failed");

        alert("Equipment updated successfully!");
        loadAdminDashboard();
    } catch (error) {
        alert("Update failed: " + error.message);
        loadAdminDashboard();
    }
}

// Edit Equipment Details Prompt
function editEquipment(item) {
    const name = prompt("Equipment Name:", item.name);
    if (name === null) return;

    const category = prompt("Category:", item.category || "");
    if (category === null) return;

    const code = prompt("Equipment Code:", item.equipment_code);
    if (code === null) return;

    const rfid = prompt("RFID Tag:", item.rfid_tag || "");
    if (rfid === null) return;

    updateEquipment(item, {
        name: name.trim(),
        category: category.trim(),
        equipment_code: code.trim(),
        rfid_tag: rfid.trim()
    });
}

// Student Account Lookup Function
async function searchStudentAccount() {
    const studentIdInput = document.getElementById("studentLookupId");
    if (!studentIdInput) return;

    const studentId = studentIdInput.value.trim();

    if (!studentId) {
        alert("Please enter a Student ID to search.");
        return;
    }

    const container = document.getElementById("studentDetailsContainer");

    try {
        let response;
        try {
            response = await fetch(`http://localhost:3000/api/admin/student/${encodeURIComponent(studentId)}`);
        } catch (err) {
            response = await fetch(`http://127.0.0.1:3000/api/admin/student/${encodeURIComponent(studentId)}`);
        }

        const data = await response.json();

        if (!response.ok) {
            alert(data.message || "Student not found.");
            if (container) container.style.display = "none";
            return;
        }

        // Display Student Profile
        setElementText("studentProfileName", data.student.name);
        setElementText("studentProfileId", data.student.student_id);
        setElementText("studentProfileEmail", data.student.email || "-");
        setElementText("studentProfileRole", data.student.role);

        // Render Active Withdrawals (Checked out equipment)
        const activeTable = document.getElementById("activeWithdrawalsTable");
        const activeTx = (data.transactions || []).filter(t => String(t.status).toUpperCase() === "ACTIVE");

        if (activeTx.length === 0) {
            activeTable.innerHTML = `<tr><td colspan="6" style="text-align:center;">No active withdrawals (currently checked out equipment).</td></tr>`;
        } else {
            activeTable.innerHTML = activeTx.map(t => `
                <tr>
                    <td>${t.transaction_id}</td>
                    <td>${escapeHTML(t.equipment_code || "-")}</td>
                    <td>${escapeHTML(t.equipment_name || "-")}</td>
                    <td>${formatDate(t.checkout_time)}</td>
                    <td><span class="status-badge active">ACTIVE</span></td>
                    <td>
                        <button class="action-btn" onclick="adminReturnEquipment(${t.equipment_id})">
                            Return Equipment
                        </button>
                    </td>
                </tr>
            `).join("");
        }

        // Render Full Transaction History for this Student
        const txTable = document.getElementById("studentTransactionsTable");
        const allTx = data.transactions || [];

        if (allTx.length === 0) {
            txTable.innerHTML = `<tr><td colspan="6" style="text-align:center;">No transaction history for this student.</td></tr>`;
        } else {
            txTable.innerHTML = allTx.map(t => {
                const rawStatus = t.status || "UNKNOWN";
                const statusClass = rawStatus.toLowerCase().replace(/[\s_]+/g, "-");

                return `
                    <tr>
                        <td>${t.transaction_id}</td>
                        <td>${escapeHTML(t.equipment_code || "-")}</td>
                        <td>${escapeHTML(t.equipment_name || "-")}</td>
                        <td>${formatDate(t.checkout_time)}</td>
                        <td>${formatDate(t.return_time)}</td>
                        <td>
                            <span class="status-badge ${statusClass}">
                                ${rawStatus}
                            </span>
                        </td>
                    </tr>
                `;
            }).join("");
        }

        if (container) container.style.display = "block";

    } catch (error) {
        console.error("Student lookup error:", error);
        alert("Failed to fetch student account details. Check backend connection.");
    }
}

// Admin Return Override
async function adminReturnEquipment(equipmentId) {
    if (!confirm("Are you sure you want to return this equipment for the student?")) {
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
            searchStudentAccount(); // Refresh student view
            loadAdminDashboard();   // Refresh inventory
        } else {
            alert(data.message || "Return failed");
        }
    } catch (error) {
        console.error("Admin return failed:", error);
        alert("Cannot connect to server.");
    }
}

document.addEventListener("DOMContentLoaded", loadAdminDashboard);
