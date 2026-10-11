
require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

app.use(cors());
app.use(express.json());

// Nodemailer Gmail Setup
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";

let transporter = null;

if (EMAIL_USER && EMAIL_PASS && EMAIL_USER !== "your-gmail@gmail.com") {
    transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });
    console.log("Nodemailer Gmail Transporter configured for:", EMAIL_USER);
}

// MySQL connection
const db = mysql.createConnection({
    host: process.env.MYSQLHOST || process.env.DB_HOST || "127.0.0.1",
    user: process.env.MYSQLUSER || process.env.DB_USER || "root",
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "",
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || "lems_db",
    port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306)
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error("MySQL connection failed:", err.message);
    } else {
        console.log("MySQL connected successfully!");

        // Ensure reset_token and reset_token_expires columns exist in users table
        db.query("ALTER TABLE users ADD COLUMN reset_token VARCHAR(255) NULL, ADD COLUMN reset_token_expires DATETIME NULL", (err) => {
            // Ignore error if columns already exist
        });

        // Ensure complaints table exists
        const createComplaintsTableSql = `
            CREATE TABLE IF NOT EXISTS complaints (
                complaint_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NULL,
                equipment_id INT NULL,
                issue_description TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'PENDING',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        db.query(createComplaintsTableSql, (err) => {
            if (err) console.error("Could not create complaints table:", err.message);
        });

        // Ensure total_quantity and available_quantity columns exist in equipment table
        db.query("ALTER TABLE equipment ADD COLUMN total_quantity INT DEFAULT 50, ADD COLUMN available_quantity INT DEFAULT 50", (err) => {
            db.query("UPDATE equipment SET total_quantity = 50 WHERE total_quantity IS NULL OR total_quantity = 0");
            db.query("UPDATE equipment SET available_quantity = 50 WHERE available_quantity IS NULL");
            db.query("UPDATE equipment SET status = 'AVAILABLE' WHERE available_quantity > 0 AND status NOT IN ('MAINTENANCE', 'LOST')");
        });

        // Auto-create an example admin if no admin exists in users table
        const checkAdminSql = "SELECT * FROM users WHERE LOWER(role) = 'admin'";
        db.query(checkAdminSql, (err, rows) => {
            if (!err && rows.length === 0) {
                const createAdminSql = `
                    INSERT INTO users (name, student_id, email, password, role)
                    VALUES ('Lab Admin', 'A101', 'admin@lems.com', 'admin123', 'admin')
                `;
                db.query(createAdminSql, (err) => {
                    if (!err) {
                        console.log("Created default Admin user -> ID: A101 | Password: admin123");
                    } else {
                        console.error("Could not auto-create admin:", err.message);
                    }
                });
            }
        });
    }
});

// Home API
app.get("/", (req, res) => {
    res.send("LEMS Backend API is running");
});

// Get all equipment
app.get("/api/equipment", (req, res) => {
    db.query("SELECT * FROM equipment", (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json(results);
    });
});

app.put("/api/equipment/:id", (req, res) => {
    const { id } = req.params;
    const {
        equipment_code,
        name,
        category,
        rfid_tag,
        status,
        calibration_limit
    } = req.body;

    const allowedStatuses = [
        "AVAILABLE",
        "IN_USE",
        "MAINTENANCE",
        "LOST"
    ];

    if (!equipment_code || !name || !category || !rfid_tag) {
        return res.status(400).json({
            message: "Please fill in all required fields."
        });
    }

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            message: "Invalid equipment status."
        });
    }

    const sql = `
        UPDATE equipment
        SET equipment_code = ?,
            name = ?,
            category = ?,
            rfid_tag = ?,
            status = ?,
            calibration_limit = ?
        WHERE equipment_id = ?
    `;

    const values = [
        equipment_code,
        name,
        category,
        rfid_tag,
        status,
        calibration_limit || 500,
        id
    ];

    db.query(sql, values, (error, result) => {
        if (error) {
            console.error("Update equipment error:", error);
            return res.status(500).json({
                message: "Could not update equipment."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Equipment not found."
            });
        }

        res.json({
            message: "Equipment updated successfully!"
        });
    });
});

// Sign Up / Registration API
app.post("/api/signup", (req, res) => {
    const { name, student_id, email, password, role } = req.body;

    if (!name || !student_id || !email || !password) {
        return res.status(400).json({
            message: "Name, Student ID, Email, and Password are required."
        });
    }

    const userRole = (role && String(role).toLowerCase() === "admin") ? "admin" : "student";

    // Check if student_id or email already exists
    const checkSql = "SELECT user_id FROM users WHERE student_id = ? OR email = ?";
    db.query(checkSql, [student_id.trim(), email.trim()], (err, results) => {
        if (err) {
            console.error("Signup check error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (results.length > 0) {
            return res.status(400).json({
                message: "User with this Student ID or Email already exists."
            });
        }

        // Insert new user into database
        const insertSql = `
            INSERT INTO users (name, student_id, email, password, role)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(insertSql, [name.trim(), student_id.trim(), email.trim(), password.trim(), userRole], (err, result) => {
            if (err) {
                console.error("Signup insert error:", err.message);
                return res.status(500).json({ error: err.message });
            }

            res.status(201).json({
                message: "Account created successfully! You can now log in."
            });
        });
    });
});

app.post("/api/login", (req, res) => {
    const { student_id, password } = req.body;

    if (!student_id || !password) {
        return res.status(400).json({
            message: "Student ID and password are required"
        });
    }

    const sql = `
        SELECT user_id, name, student_id, email, role
        FROM users
        WHERE student_id = ? AND password = ?
    `;

    db.query(sql, [student_id, password], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (results.length === 0) {
            return res.status(401).json({
                message: "Invalid student ID or password"
            });
        }

        res.json({
            message: "Login successful",
            user: results[0]
        });
    });
});

// Forgot Password API - Generates reset link & sends real email
app.post("/api/forgot-password", (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: "Email is required." });
    }

    const checkSql = "SELECT user_id, name, email FROM users WHERE email = ?";
    db.query(checkSql, [email.trim()], (err, users) => {
        if (err) {
            console.error("Forgot password SQL error:", err);
            return res.status(500).json({ error: err.message });
        }

        if (users.length === 0) {
            return res.status(404).json({ message: "No account found with this email address." });
        }

        const user = users[0];
        const token = crypto.randomBytes(20).toString("hex");
        // Expires in 1 hour
        const expires = new Date(Date.now() + 3600000);

        const updateSql = "UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE user_id = ?";
        db.query(updateSql, [token, expires, user.user_id], (err) => {
            if (err) {
                console.error("Token save error:", err);
                return res.status(500).json({ error: err.message });
            }

            const resetLink = `http://127.0.0.1:8080/reset-password.html?token=${token}`;
            console.log("\n==========================================");
            console.log(`PASSWORD RESET LINK FOR ${user.email}:`);
            console.log(resetLink);
            console.log("==========================================\n");

            // Send real email if Gmail credentials are provided
            if (transporter) {
                const mailOptions = {
                    from: `"LEMS System" <${EMAIL_USER}>`,
                    to: user.email,
                    subject: "LEMS - Password Reset Request",
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                            <h2 style="color: #1976d2;">LEMS - Password Reset Request</h2>
                            <p>Hello <strong>${String(user.name || "User")}</strong>,</p>
                            <p>You requested to reset your password for your LEMS account.</p>
                            <p>Click the button below to reset your password (link expires in 1 hour):</p>
                            <p style="margin: 20px 0;">
                                <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #1976d2; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
                                    Reset Password
                                </a>
                            </p>
                            <p style="color: #666; font-size: 13px;">Or copy and paste this URL into your browser:</p>
                            <p style="color: #1976d2; font-size: 13px;">${resetLink}</p>
                            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                            <p style="font-size: 12px; color: #999;">If you did not request a password reset, please ignore this email.</p>
                        </div>
                    `
                };

                transporter.sendMail(mailOptions, (mailErr, info) => {
                    if (mailErr) {
                        console.error("Nodemailer Email delivery error:", mailErr.message);
                    } else {
                        console.log("Real email sent to:", user.email, "| Status:", info.response);
                    }
                });
            }

            res.json({
                message: "Password reset link generated! Check your email inbox.",
                resetLink: resetLink
            });
        });
    });
});

// Reset Password API - Updates password using token
app.post("/api/reset-password", (req, res) => {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
        return res.status(400).json({ message: "Token and new password are required." });
    }

    const checkSql = "SELECT user_id, reset_token_expires FROM users WHERE reset_token = ?";
    db.query(checkSql, [token.trim()], (err, users) => {
        if (err) {
            console.error("Reset password check error:", err);
            return res.status(500).json({ error: err.message });
        }

        if (users.length === 0) {
            return res.status(400).json({ message: "Invalid or unrecognized password reset token." });
        }

        const user = users[0];

        // Expiration check in JS to prevent MySQL timezone mismatches
        if (user.reset_token_expires && new Date(user.reset_token_expires).getTime() < Date.now()) {
            return res.status(400).json({ message: "Password reset link has expired. Please request a new one." });
        }

        const userId = user.user_id;
        const updateSql = "UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE user_id = ?";
        db.query(updateSql, [new_password.trim(), userId], (err) => {
            if (err) {
                console.error("Password update error:", err);
                return res.status(500).json({ error: err.message });
            }

            res.json({ message: "Password reset successful! You can now log in with your new password." });
        });
    });
});

// Submit Complaint / Maintenance Request API (Student Side)
app.post("/api/complaints", (req, res) => {
    console.log("POST /api/complaints received body:", req.body);
    const { user_id, equipment_id, issue_description } = req.body;

    if (!user_id || !equipment_id || !issue_description) {
        return res.status(400).json({ message: "User ID, Equipment ID, and Issue Description are required." });
    }

    const insertSql = `
        INSERT INTO complaints (user_id, equipment_id, issue_description, status)
        VALUES (?, ?, ?, 'PENDING')
    `;

    db.query(insertSql, [user_id, equipment_id, issue_description.trim()], (err, result) => {
        if (err) {
            console.error("Submit complaint error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        // Update equipment status to MAINTENANCE
        db.query("UPDATE equipment SET status = 'MAINTENANCE' WHERE equipment_id = ?", [equipment_id], (err) => {
            if (err) console.error("Error updating equipment status to MAINTENANCE:", err.message);
        });

        res.status(201).json({
            message: "Maintenance complaint submitted successfully! Equipment marked for review."
        });
    });
});

// Get All Complaints API (Admin Side)
app.get("/api/complaints", (req, res) => {
    const sql = `
        SELECT
            c.complaint_id,
            c.issue_description,
            c.status AS complaint_status,
            c.created_at,
            u.name AS student_name,
            u.student_id,
            e.equipment_id,
            e.equipment_code,
            e.name AS equipment_name,
            e.status AS equipment_status
        FROM complaints c
        LEFT JOIN users u ON c.user_id = u.user_id
        LEFT JOIN equipment e ON c.equipment_id = e.equipment_id
        ORDER BY c.complaint_id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Get complaints warning:", err.message);
            // Return empty list safely if table doesn't exist yet
            return res.json([]);
        }

        res.json(results);
    });
});

// Resolve Complaint API (Admin Side)
app.put("/api/complaints/:id/resolve", (req, res) => {
    const complaintId = req.params.id;
    const { equipment_id, make_available } = req.body;

    const updateSql = "UPDATE complaints SET status = 'RESOLVED' WHERE complaint_id = ?";
    db.query(updateSql, [complaintId], (err, result) => {
        if (err) {
            console.error("Resolve complaint error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (make_available !== false && equipment_id) {
            db.query("UPDATE equipment SET status = 'AVAILABLE' WHERE equipment_id = ?", [equipment_id], (err) => {
                if (err) console.error("Error restoring equipment status to AVAILABLE:", err.message);
            });
        }

        res.json({ message: "Complaint resolved and equipment status updated!" });
    });
});

// Checkout equipment API
app.post("/api/checkout", (req, res) => {
    const { user_id, equipment_id } = req.body;

    if (!user_id || !equipment_id) {
        return res.status(400).json({
            message: "User ID and equipment ID are required"
        });
    }

    // Check student exists
    db.query(
        "SELECT user_id FROM users WHERE user_id = ?",
        [user_id],
        (err, users) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (users.length === 0) {
                return res.status(404).json({
                    message: "Student not found. Please log in again."
                });
            }

            // Check if user already has an active checkout for this equipment
            db.query(
                "SELECT transaction_id FROM transactions WHERE user_id = ? AND equipment_id = ? AND status = 'ACTIVE'",
                [user_id, equipment_id],
                (err, activeTxs) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }

                    if (activeTxs.length > 0) {
                        return res.status(400).json({
                            message: "You already have an active checkout for this equipment. You must return it first."
                        });
                    }

                    // Check equipment availability and quantity
                    db.query(
                        "SELECT status, COALESCE(available_quantity, 50) AS available_quantity, COALESCE(total_quantity, 50) AS total_quantity FROM equipment WHERE equipment_id = ?",
                        [equipment_id],
                        (err, equipment) => {
                            if (err) {
                                return res.status(500).json({ error: err.message });
                            }

                            if (equipment.length === 0) {
                                return res.status(404).json({
                                    message: "Equipment not found"
                                });
                            }

                            const eq = equipment[0];
                            if (eq.status === "MAINTENANCE" || eq.status === "LOST" || eq.available_quantity <= 0) {
                                return res.status(400).json({
                                    message: "Equipment is out of stock or under maintenance."
                                });
                            }

                            // Record checkout
                            db.query(
                                `INSERT INTO transactions
                                 (user_id, equipment_id, status)
                                 VALUES (?, ?, 'ACTIVE')`,
                                [user_id, equipment_id],
                                (err, result) => {
                                    if (err) {
                                        return res.status(500).json({ error: err.message });
                                    }

                                    // Decrement available_quantity and set status to OUT_OF_STOCK if 0
                                    db.query(
                                        `UPDATE equipment
                                         SET available_quantity = GREATEST(0, COALESCE(available_quantity, 50) - 1),
                                             status = CASE WHEN (COALESCE(available_quantity, 50) - 1) <= 0 THEN 'OUT_OF_STOCK' ELSE 'AVAILABLE' END
                                         WHERE equipment_id = ?`,
                                        [equipment_id],
                                        (err, updateResult) => {
                                            if (err) {
                                                db.query(
                                                    `DELETE FROM transactions WHERE transaction_id = ?`,
                                                    [result.insertId]
                                                );
                                                return res.status(500).json({ error: err.message });
                                            }

                                            res.json({
                                                message: "Equipment checked out successfully",
                                                transaction_id: result.insertId
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// Return equipment API
app.post("/api/return", (req, res) => {
    const { equipment_id } = req.body;

    if (!equipment_id) {
        return res.status(400).json({
            message: "Equipment ID is required"
        });
    }

    const sql = `
        SELECT transaction_id
        FROM transactions
        WHERE equipment_id = ?
          AND status = 'ACTIVE'
        ORDER BY checkout_time DESC
        LIMIT 1
    `;

    db.query(sql, [equipment_id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (results.length === 0) {
            return res.status(400).json({
                message: "No active checkout found"
            });
        }

        const transactionId = results[0].transaction_id;

        db.query(
            `UPDATE transactions
             SET status = 'RETURNED', return_time = NOW()
             WHERE transaction_id = ? AND status = 'ACTIVE'`,
            [transactionId],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                if (result.affectedRows === 0) {
                    return res.status(409).json({
                        message: "This transaction has already been returned"
                    });
                }

                // Increment available_quantity and set status to AVAILABLE
                db.query(
                    `UPDATE equipment
                     SET available_quantity = LEAST(COALESCE(total_quantity, 50), COALESCE(available_quantity, 0) + 1),
                         status = 'AVAILABLE'
                     WHERE equipment_id = ?`,
                    [equipment_id],
                    (err, updateResult) => {
                        if (err) {
                            return res.status(500).json({ error: err.message });
                        }

                        res.json({
                            message: "Equipment returned successfully"
                        });
                    }
                );
            }
        );
    });
});

// RFID Kiosk Scan API (ESP32 Hardware Integration)
app.post("/api/kiosk/scan", (req, res) => {
    const { student_rfid, equipment_rfid } = req.body;

    if (!student_rfid || !equipment_rfid) {
        return res.status(400).json({ message: "Student RFID and Equipment RFID are required." });
    }

    db.query("SELECT user_id, name, student_id FROM users WHERE rfid_uid = ?", [student_rfid.trim()], (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        if (users.length === 0) {
            return res.status(404).json({ message: "Student RFID card not registered." });
        }

        const user = users[0];

        db.query("SELECT equipment_id, equipment_code, name, status, available_quantity FROM equipment WHERE rfid_tag = ?", [equipment_rfid.trim()], (err, equipmentList) => {
            if (err) return res.status(500).json({ error: err.message });
            if (equipmentList.length === 0) {
                return res.status(404).json({ message: "Equipment RFID tag not found." });
            }

            const equipment = equipmentList[0];

            db.query("SELECT transaction_id FROM transactions WHERE user_id = ? AND equipment_id = ? AND status = 'ACTIVE'", [user.user_id, equipment.equipment_id], (err, activeTxs) => {
                if (err) return res.status(500).json({ error: err.message });

                if (activeTxs.length > 0) {
                    // PROCESS RETURN
                    const transactionId = activeTxs[0].transaction_id;
                    db.query("UPDATE transactions SET status = 'RETURNED', return_time = NOW() WHERE transaction_id = ?", [transactionId], (err) => {
                        if (err) return res.status(500).json({ error: err.message });

                        db.query("UPDATE equipment SET available_quantity = LEAST(COALESCE(total_quantity, 50), COALESCE(available_quantity, 0) + 1), status = 'AVAILABLE' WHERE equipment_id = ?", [equipment.equipment_id], (err) => {
                            if (err) return res.status(500).json({ error: err.message });

                            res.json({
                                action: "RETURN",
                                message: `Return successful for ${user.name} (${equipment.name})`
                            });
                        });
                    });
                } else {
                    // PROCESS CHECKOUT
                    if (equipment.status === "MAINTENANCE" || equipment.status === "LOST" || (equipment.available_quantity ?? 50) <= 0) {
                        return res.status(400).json({ message: "Equipment is out of stock or under maintenance." });
                    }

                    db.query("INSERT INTO transactions (user_id, equipment_id, status) VALUES (?, ?, 'ACTIVE')", [user.user_id, equipment.equipment_id], (err, result) => {
                        if (err) return res.status(500).json({ error: err.message });

                        db.query(
                            `UPDATE equipment
                             SET available_quantity = GREATEST(0, COALESCE(available_quantity, 50) - 1),
                                 status = CASE WHEN (COALESCE(available_quantity, 50) - 1) <= 0 THEN 'OUT_OF_STOCK' ELSE 'AVAILABLE' END
                             WHERE equipment_id = ?`,
                            [equipment.equipment_id],
                            (err) => {
                                if (err) return res.status(500).json({ error: err.message });

                                res.json({
                                    action: "CHECKOUT",
                                    message: `Checkout successful for ${user.name} (${equipment.name})`
                                });
                            }
                        );
                    });
                }
            });
        });
    });
});

// Get active checkouts for a specific user
app.get("/api/transactions/user/:user_id", (req, res) => {
    const userId = req.params.user_id;
    const sql = `
        SELECT transaction_id, equipment_id, checkout_time, status
        FROM transactions
        WHERE user_id = ? AND status = 'ACTIVE'
    `;
    db.query(sql, [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Transaction history API
app.get("/api/transactions", (req, res) => {
    console.log("API /api/transactions requested");
    const sql = `
        SELECT
            t.transaction_id,
            u.name AS student_name,
            u.student_id,
            e.equipment_code,
            e.name AS equipment_name,
            t.checkout_time,
            t.return_time,
            t.status
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.user_id
        LEFT JOIN equipment e ON t.equipment_id = e.equipment_id
        ORDER BY t.transaction_id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Database error in /api/transactions:", err.message);
            return res.status(500).json({ error: err.message });
        }

        console.log(`Found ${results.length} transactions`);
        res.json(results);
    });
});

// Admin API: Get student account details & transaction history by student_id
app.get("/api/admin/student/:student_id", (req, res) => {
    const studentId = req.params.student_id;

    const userSql = "SELECT user_id, name, student_id, email, role FROM users WHERE student_id = ?";

    db.query(userSql, [studentId], (err, users) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (users.length === 0) {
            return res.status(404).json({ message: "Student not found with ID: " + studentId });
        }

        const user = users[0];

        const txSql = `
            SELECT
                t.transaction_id,
                e.equipment_id,
                e.equipment_code,
                e.name AS equipment_name,
                t.checkout_time,
                t.return_time,
                t.status
            FROM transactions t
            LEFT JOIN equipment e ON t.equipment_id = e.equipment_id
            WHERE t.user_id = ?
            ORDER BY t.transaction_id DESC
        `;

        db.query(txSql, [user.user_id], (err, transactions) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            res.json({
                student: user,
                transactions: transactions
            });
        });
    });
});

// Start server — keep this at the bottom
const PORT = Number(process.env.PORT) || 3000;

app.post("/api/equipment", (req, res) => {
    const {
        equipment_code,
        name,
        category,
        rfid_tag,
        calibration_limit
    } = req.body;

    if (
        !equipment_code ||
        !name ||
        !category ||
        !rfid_tag
    ) {
        return res.status(400).json({
            message: "Please fill in all required fields."
        });
    }

    const sql = `
        INSERT INTO equipment
        (equipment_code, name, category, rfid_tag,
         status, runtime_hours, calibration_limit)
        VALUES (?, ?, ?, ?, 'AVAILABLE', 0, ?)
    `;

    const values = [
        equipment_code,
        name,
        category,
        rfid_tag,
        calibration_limit || 500
    ];

    db.query(sql, values, (error, result) => {
        if (error) {
            console.error("Add equipment error:", error);

            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    message:
                        "Equipment code or RFID tag already exists."
                });
            }

            return res.status(500).json({
                message: "Could not add equipment."
            });
        }

        res.status(201).json({
            message: "Equipment added successfully!",
            equipment_id: result.insertId
        });
    });
});
app.listen(PORT, () => {
    console.log(`LEMS API running on port ${PORT}`);
});