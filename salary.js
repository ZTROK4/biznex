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


router.post('/add-salary', async (req, res) => {
    let {
      employee_id,
      salary_amount,
      salary_month,
      payment_method,
      payment_date
    } = req.body;
  
    salary_month = `${salary_month}-01`; // Format as full date
  
    if (!employee_id || !salary_amount || !salary_month || !payment_method) {
      return res.status(400).json({ error: 'Missing required salary data.' });
    }
  
    try {
      // Fetch employee name
      const empResult = await req.db.query(
        'SELECT first_name, last_name FROM employees WHERE id = $1',
        [employee_id]
      );
  
      if (empResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
  
      const { first_name, last_name } = empResult.rows[0];
      const employeeName = `${first_name} ${last_name}`;
  
      // Insert salary record
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
          payment_date || new Date()
        ]
      );
  
      // Also insert into man_expenses
      await req.db.query(
        `INSERT INTO man_expenses (description, amount, expense_date, type)
         VALUES ($1, $2, $3, 'salary')`,
        [`Salary to ${employeeName}`, salary_amount, payment_date || new Date()]
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
          TO_CHAR(s.payment_date, 'DD/MM/YYYY') AS payment_date,
          TO_CHAR(s.salary_month, 'Mon YYYY') AS salary_month,
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
  
  

module.exports = router;