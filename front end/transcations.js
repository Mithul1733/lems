async function loadTransactions() {
    const table = document.getElementById("transactionTable");

    if (!table) {
        console.error("transactionTable element not found in DOM");
        return;
    }

    try {
        table.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center;">Loading transactions...</td>
            </tr>
        `;

        console.log("Fetching transactions from API...");

        let response;
        try {
            response = await fetch("http://localhost:3000/api/transactions");
        } catch (fetchErr) {
            console.warn("Failed fetch from localhost, trying 127.0.0.1...", fetchErr);
            response = await fetch("http://127.0.0.1:3000/api/transactions");
        }

        if (!response.ok) {
            throw new Error("Server response error: " + response.status + " " + response.statusText);
        }

        const transactions = await response.json();
        console.log("Transactions loaded:", transactions);

        if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
            table.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center;">No transactions found.</td>
                </tr>
            `;
            return;
        }

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

        table.innerHTML = transactions.map(item => {
            const rawStatus = item.status || "UNKNOWN";
            const statusClass = rawStatus.toLowerCase().replace(/[\s_]+/g, "-");

            return `
                <tr>
                    <td>${item.transaction_id}</td>
                    <td>${item.student_name || "-"}</td>
                    <td>${item.student_id || "-"}</td>
                    <td>${item.equipment_code || "-"}</td>
                    <td>${item.equipment_name || "-"}</td>
                    <td>${formatDate(item.checkout_time)}</td>
                    <td>${formatDate(item.return_time)}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${rawStatus}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Transaction loading failed:", error);

        table.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: red;">
                    Failed to load transactions: ${error.message}
                </td>
            </tr>
        `;
    }
}

function searchTransactions() {
    const searchInput = document.getElementById("transactionSearch");
    if (!searchInput) return;

    const search = searchInput.value.toLowerCase();

    document.querySelectorAll("#transactionTable tr").forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(search)
            ? ""
            : "none";
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadTransactions);
} else {
    loadTransactions();
}
