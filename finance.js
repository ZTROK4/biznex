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




//1- add payyable accounts
router.post('/add-pay-acc', async (req, res) => {
    try {
        const { account_name, amount, payment_date, payment_method, status } = req.body;

        if (!account_name || !amount || !payment_date || !payment_method || !status) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const query = `
            INSERT INTO accounts_payable (account_name, amount, payment_date, payment_method, status)
            VALUES ($1, $2, $3, $4, $5) RETURNING *;
        `;

        const values = [account_name, amount, payment_date, payment_method, status];

        const result = await req.db.query(query, values);

        res.status(201).json({ message: 'Account Payable added successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error adding payable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//2- add receivable accounts
router.post('/add-recv-acc', async (req, res) => {
    try {
        const { account_name, amount, due_date, payment_method, status } = req.body;
       
        if (!account_name || !amount || !due_date || !payment_method || !status) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const query = `
            INSERT INTO accounts_receivable (account_name, amount, due_date,payment_method, status)
            VALUES ($1, $2, $3, $4,$5) RETURNING *;
        `;

        const values = [account_name, amount, due_date,payment_method, status];

        const result = await req.db.query(query, values);

        res.status(201).json({ message: 'Account Receivable added successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error adding receivable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//3-update status payyable account
router.put('/update-pay-acc', async (req, res) => {
    try {
        const { id, account_name, amount, payment_date, payment_method, status } = req.body;



        if (!id || !account_name || amount == null|| !payment_date || !payment_method || !status) {
            return res.status(400).json({ error: 'ID and all fields are required' });
        }

        const query = `
            UPDATE accounts_payable
            SET account_name = $1, amount = $2, payment_date = $3, payment_method = $4, status = $5
            WHERE id = $6
            RETURNING *;
        `;

        const values = [account_name, amount, payment_date, payment_method, status, id];

        const result = await req.db.query(query, values);

        console.log('Update result:', result); // ✅ Helpful to check DB response

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Payable account not found' });
        }

        res.json({ message: 'Account Payable updated successfully', updatedAccount: result.rows[0] });

    } catch (error) {
        console.error('Error updating payable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});




//4- update status receivable account
router.put('/update-recv-acc', async (req, res) => {
    try {
        const { id, account_name, amount, due_date, payment_method, status } = req.body; 

        if (!id || !account_name || !amount || !due_date || !payment_method || !status) {
            return res.status(400).json({ error: 'All fields including ID are required' });
        }

        const query = `
            UPDATE accounts_receivable
            SET account_name = $1, amount = $2, due_date = $3, payment_method = $4, status = $5
            WHERE id = $6
            RETURNING *;
        `;

        const values = [account_name, amount, due_date, payment_method, status, id];

        const result = await req.db.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Receivable account not found' });
        }

        res.json({ message: 'Receivable account updated successfully', updatedAccount: result.rows[0] });

    } catch (error) {
        console.error('Error updating receivable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

router.post('/delete-pay-acc', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Account ID is required' });
        }

        const query = `
            DELETE FROM accounts_payable WHERE id = $1 RETURNING *;
        `;

        const result = await req.db.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }

        res.status(200).json({ message: 'Account Payable deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting payable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

router.post('/delete-recv-acc', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Account ID is required' });
        }

        const query = `
            DELETE FROM accounts_receivable WHERE id = $1 RETURNING *;
        `;

        const result = await req.db.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }

        res.status(200).json({ message: 'Account Payable deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting payable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//5- display the payyable accounts
router.get('/accounts', async (req, res) => {
    try {
        const [payableResult, receivableResult] = await Promise.all([
            req.db.query(`
                SELECT 
                    id,
                    account_name,
                    amount,
                    TO_CHAR(payment_date, 'DD/MM/YYYY') AS payment_date,
                    payment_method,
                    status
                FROM accounts_payable
                ORDER BY created_at DESC;
            `),
            req.db.query(`
                SELECT 
                    id,
                    account_name,
                    amount,
                    TO_CHAR(due_date, 'DD/MM/YYYY') AS due_date,
                    payment_method,
                    status
                FROM accounts_receivable
                ORDER BY created_at DESC;
            `)
        ]);

        res.json({
            payable: payableResult.rows,
            receivable: receivableResult.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//7- add manual transactions

router.post('/add-man-transaction', async (req, res) => {
    try {
        const { type , description, amount, date } = req.body;
        console.log(req.body);

        if (!['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type. Use "income" or "expense".' });
        }

        if (!description || !amount || !date) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        const tableName = type === 'income' ? 'man_incomes' : 'man_expenses';
        const dateColumn = type === 'income' ? 'income_date' : 'expense_date';

        const query = `
            INSERT INTO ${tableName} ( description, amount, ${dateColumn}, type)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;

        const values = [ description, amount, date, type];
        const result = await req.db.query(query, values);

        res.status(201).json({ message: `${type} added successfully`, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database insertion failed' });
    }
});

//update man tran

router.put('/update-man-transaction', async (req, res) => {
    try {
      const { id,type, description, amount, date } = req.body;
  
      if (!['income', 'expense'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type. Use "income" or "expense".' });
      }
  
      if (!description || !amount || !date) {
        return res.status(400).json({ error: 'Missing required fields.' });
      }
  
      const tableName = type === 'income' ? 'man_incomes' : 'man_expenses';
      const dateColumn = type === 'income' ? 'income_date' : 'expense_date';
  
      const query = `
        UPDATE ${tableName}
        SET description = $1, amount = $2, ${dateColumn} = $3
        WHERE id = $4
        RETURNING *;
      `;
  
      const values = [description, amount, date, id];
      const result = await req.db.query(query, values);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
  
      res.status(200).json({ message: `${type} updated successfully`, data: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database update failed' });
    }
  });

  //deleter mnual transactions

  router.post('/delete-man-transaction', async (req, res) => {
    try {
      const { id,type } = req.body;
  
      if (!['income', 'expense'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type. Use "income" or "expense".' });
      }
  
      const tableName = type === 'income' ? 'man_incomes' : 'man_expenses';
  
      const query = `DELETE FROM ${tableName} WHERE id = $1 RETURNING *;`;
      const result = await req.db.query(query, [id]);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
  
      res.status(200).json({ message: `${type} deleted successfully`, data: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Database deletion failed' });
    }
  });
  
  
//8- display manual transactions

router.get('/manual-transactions', async (req, res) => {
    try {
        const query = `
            SELECT id, description, amount, income_date AS date, 'income' AS type
            FROM man_incomes
            UNION ALL
            SELECT id, description, amount, expense_date AS date, 'expense' AS type
            FROM man_expenses
            ORDER BY date DESC;
        `;

        const result = await req.db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

router.get('/web-bills', async (req, res) => {
    try {
      const query = 'SELECT * FROM web_bills ORDER BY generated_at DESC;';
      const result = await req.db.query(query); // req.db must be the connected PostgreSQL client
      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Error fetching web bills:', error);
      res.status(500).json({ error: 'Failed to fetch web bills' });
    }
  });

 /* router.get('/bills', async (req, res) => {
    try {
      const result = await req.db.query('SELECT * FROM bills ORDER BY generated_at DESC');
      res.status(200).json(result.rows);
    } catch (err) {
      console.error('Error fetching bills:', err);
      res.status(500).json({ error: 'Failed to fetch bills' });
    }
  });*/

  router.get('/bills', async (req, res) => {
    try {
      const query = `
        SELECT 
          b.bill_id,
          b.total_amount,
          b.payment_status,
          b.payment_method,
          b.generated_at,
          b.cart_id,
  
          p.id AS product_id,
          p.name AS product_name,
          p.price AS product_price,
          ci.quantity
  
        FROM bills b
        JOIN cart_items ci ON b.cart_id = ci.cart_id
        JOIN products p ON ci.product_id = p.id
        ORDER BY b.generated_at DESC;
      `;
  
      const result = await req.db.query(query);
  
      // Group by bill_id
      const billsMap = new Map();
  
      for (const row of result.rows) {
        const {
          bill_id,
          cart_id,
          total_amount,
          payment_status,
          payment_method,
          generated_at,
          product_id,
          product_name,
          product_price,
          quantity
        } = row;
  
        if (!billsMap.has(bill_id)) {
          billsMap.set(bill_id, {
            bill_id,
            cart_id,
            total_amount,
            payment_status,
            payment_method,
            generated_at,
            products: []
          });
        }
  
        billsMap.get(bill_id).products.push({
          product_id,
          name: product_name,
          price: product_price,
          quantity
        });
      }
  
      res.status(200).json(Array.from(billsMap.values()));
    } catch (error) {
      console.error('Error retrieving all bills with products:', error);
      res.status(500).json({ error: 'Failed to retrieve bills' });
    }
  });
  
  
  

  router.get('/web-bills/products', async (req, res) => {
    const { orderId } = req.params;
  
    try {
      const query = `
        SELECT 
          oi.order_item_id,
          oi.quantity,
          oi.unit_price,
          p.id AS product_id,
          p.name,
          p.price,
          p.description,
          p.barcode,
          p.category,
          p.status,
          p.bestseller,
          p.imageUrl,
          p.type
        FROM order_item oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `;
  
      const result = await req.db.query(query, [orderId]);
      res.status(200).json({ order_id: orderId, items: result.rows });
  
    } catch (error) {
      console.error('Error retrieving order items:', error);
      res.status(500).json({ error: 'Failed to retrieve web bill items' });
    }
  });

  
  


module.exports = router;