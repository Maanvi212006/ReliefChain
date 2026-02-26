const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();
connectDB();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());
app.use("/uploads", express.static("uploads")); // serve uploaded images

// Routes
app.use("/api/campaigns", require("./routes/campaigns"));
app.use("/api/auth",      require("./routes/auth"));
app.use("/api/admin",     require("./routes/admin"));
app.use("/api/donations", require("./routes/donations"));

app.get("/", (req, res) => res.json({ message: "Fake Donation Control API running ✅" }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || "Server Error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
