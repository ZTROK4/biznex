const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');
const jwt = require("jsonwebtoken");
const pg = require("pg");


router.use(async (req, res, next) => {
    const token = req.headers["authorization"]?.split(" ")[1]; 
    if (!token) {
        return res.status(400).json({ error: "No token provided. Please log in first." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.dbname = decoded.dbname; 

        req.db = new pg.Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: req.dbname,  
        });

        next();  
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: "Invalid or expired token" });
    }
});



router.post('/salary', async (req, res) => {
    const {
      employee_id,
      salary_amount,
      salary_month,
      payment_method,
      payment_date
    } = req.body;
  
    // Validate required fields
    if (
      !employee_id || !salary_amount || !salary_month || !payment_method
    ) {
      return res.status(400).json({ error: 'Missing required salary data.' });
    }
  
    try {
      const result = await req.db.query(
        `INSERT INTO salaries (
           employee_id,
           salary_amount,
           salary_month,
           payment_method,
           payment_date
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          employee_id,
          salary_amount,
          salary_month,
          payment_method,
          payment_date || new Date() // fallback to current date
        ]
      );
  
      res.status(201).json({
        success: true,
        message: 'Salary record added successfully',
        salary: result.rows[0]
      });
    } catch (error) {
      console.error('Error inserting salary:', error);
      res.status(500).json({ error: 'Failed to add salary record' });
    }
});

router.get('/salaries', async (req, res) => {
    try {
      const query = `
        SELECT 
          CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
          s.salary_amount,
          s.payment_date,
          s.salary_month,
          s.payment_method
        FROM salaries s
        JOIN employees e ON s.employee_id = e.id
        ORDER BY e.first_name ASC, e.last_name ASC
      `;
  
      const result = await req.db.query(query);
  
      res.status(200).json({
        success: true,
        salaries: result.rows
      });
    } catch (error) {
      console.error('Error fetching salary data:', error);
      res.status(500).json({ error: 'Failed to retrieve salary records' });
    }
});

router.put('/salaries', async (req, res) => {
    const {id,employee_id, salary_amount, payment_date, salary_month, payment_method } = req.body;
  
    if (!employee_id || !salary_amount || !payment_date || !salary_month || !payment_method) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
  
    try {
      const result = await req.db.query(
        `UPDATE salaries 
         SET employee_id = $1,
             salary_amount = $2,
             payment_date = $3,
             salary_month = $4,
             payment_method = $5,
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [employee_id, salary_amount, payment_date, salary_month, payment_method, id]
      );
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Salary record not found' });
      }
  
      res.status(200).json({ message: 'Salary updated successfully', salary: result.rows[0] });
    } catch (error) {
      console.error('Update error:', error);
      res.status(500).json({ error: 'Failed to update salary' });
    }
  });
  
  
  router.post('/salaries', async (req, res) => {
    const { id } = req.body;
  
    try {
      const result = await req.db.query(`DELETE FROM salaries WHERE id = $1 RETURNING *`, [id]);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Salary record not found' });
      }
  
      res.status(200).json({ message: 'Salary deleted successfully' });
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: 'Failed to delete salary' });
    }
  });
  
  


module.exports = router;