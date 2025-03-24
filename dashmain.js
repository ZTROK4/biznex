const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');

router.use((req, res, next) => {
    if (!req.session.db_name) {
        return res.status(400).json({ error: 'No database selected. Please log in first.' });
    }

    if (!pool || pool.options.database !== req.session.db_name) {
        pool = new pg.Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
        });
    }

    req.db = pool;
    next();
});


//1-income value
router.get('/income/sum/all', async (req, res) => {
    try {
        const result1 = await req.db.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM bills
            WHERE DATE(generated_at) = CURRENT_DATE AND status = 'paid';
        `);

        const result2 = await req.db.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM web_bills
            WHERE DATE(generated_at) = CURRENT_DATE AND status = 'paid';
        `);

        const totalIncome = result1.rows[0].total_revenue + result2.rows[0].total_revenue;

        res.json({ total_income: totalIncome });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//2-goruped incomes each day
router.post('/income/group', async (req, res) => {
    try {
        const { groupBy = 'day' } = req.query;
        const validGroups = ['day', 'week', 'month'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            SELECT 
                DATE_TRUNC('day', generated_at) AS period, 
                COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM (
                SELECT generated_at, total_amount FROM bills WHERE status = 'paid'
                UNION ALL
                SELECT generated_at, total_amount FROM web_bills WHERE status = 'paid'
            ) AS combined_data
            WHERE generated_at >= DATE_TRUNC($1, CURRENT_DATE) 
            GROUP BY period
            ORDER BY period ASC;
        `;

        const result = await req.db.query(query, [groupBy]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//3-percent change in income
router.get('/income/percent-change', async (req, res) => {
    try {
        const query = `
            WITH weekly_income AS (
                SELECT 
                    DATE_TRUNC('week', generated_at) AS week_start,
                    SUM(total_amount) AS total_revenue
                FROM (
                    SELECT generated_at, total_amount FROM bills WHERE status = 'paid'
                    UNION ALL
                    SELECT generated_at, total_amount FROM web_bills WHERE status = 'paid'
                ) AS combined_data
                WHERE generated_at >= NOW() - INTERVAL '2 weeks'
                GROUP BY week_start
                ORDER BY week_start DESC
            )
            SELECT 
                COALESCE(
                    ROUND(
                        ((current_week.total_revenue - last_week.total_revenue) / NULLIF(last_week.total_revenue, 0)) * 100,
                        2
                    ), 0
                ) AS percent_change
            FROM 
                (SELECT total_revenue FROM weekly_income LIMIT 1) AS current_week
            LEFT JOIN 
                (SELECT total_revenue FROM weekly_income OFFSET 1 LIMIT 1) AS last_week
            ON true;
        `;

        const result = await req.db.query(query);
        res.json({ percent_change: result.rows[0].percent_change });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});
  
//4- expense value
router.get('/expense/sum/all', async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT COALESCE(SUM(amount), 0) AS total_expense
            FROM expenses
            WHERE DATE(expense_date) = CURRENT_DATE;
        `);

        const totalExpense = result.rows[0].total_expense; 

        res.json({ total_expense: totalExpense }); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


// 5- grouped expense value 
router.post('/expense/group', async (req, res) => {
    try {
        const { groupBy = 'day' } = req.query;
        const validGroups = ['day', 'week', 'month'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            SELECT 
                DATE_TRUNC('day', expense_date) AS period, 
                COALESCE(SUM(amount), 0) AS total_expense
            FROM expenses
            WHERE expense_date >= DATE_TRUNC($1, CURRENT_DATE)
            GROUP BY period
            ORDER BY period;
        `;

        const result = await req.db.query(query, [groupBy]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// 6-weekly changed expense
router.get('/expense/percent-change', async (req, res) => {
    try {
        const query = `
            WITH expense_data AS (
                SELECT 
                    DATE_TRUNC('week', expense_date) AS week_start, 
                    SUM(amount) AS total_expense
                FROM expenses
                GROUP BY week_start
            )
            SELECT 
                current_week.total_expense AS this_week_expense,
                last_week.total_expense AS last_week_expense,
                ROUND(
                    (current_week.total_expense - COALESCE(last_week.total_expense, 0)) 
                    / NULLIF(last_week.total_expense, 0) * 100, 
                    2
                ) AS percent_change
            FROM expense_data current_week
            LEFT JOIN expense_data last_week 
            ON current_week.week_start = last_week.week_start + INTERVAL '1 week'
            WHERE current_week.week_start = DATE_TRUNC('week', CURRENT_DATE);
        `;

        const result = await req.db.query(query);

        if (result.rows.length === 0) {
            return res.json({ message: "No data available for the current week." });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


// 7-orders value
app.get('/orders/count', async (req, res) => {
    try {
        const query = `
            SELECT COUNT(*) AS total_orders 
            FROM orders 
            WHERE DATE(created_at) = CURRENT_DATE AND status = 'completed';
        `;
        const result = await req.db.query(query);
        res.json({ total_orders: result.rows[0].total_orders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


// 8-weekly change orders
app.get('/orders/weekly-change', async (req, res) => {
    try {
        const query = `
            WITH current_week AS (
                SELECT COUNT(*) AS total_orders 
                FROM orders 
                WHERE created_at >= date_trunc('week', CURRENT_DATE) 
                AND status = 'completed'
            ),
            last_week AS (
                SELECT COUNT(*) AS total_orders 
                FROM orders 
                WHERE created_at >= date_trunc('week', CURRENT_DATE) - INTERVAL '1 week' 
                AND created_at < date_trunc('week', CURRENT_DATE) 
                AND status = 'completed'
            )
            SELECT 
                current_week.total_orders AS this_week_orders, 
                last_week.total_orders AS last_week_orders,
                CASE 
                    WHEN last_week.total_orders = 0 THEN NULL
                    ELSE ((current_week.total_orders - last_week.total_orders) * 100.0 / last_week.total_orders)
                END AS percent_change
            FROM current_week, last_week;
        `;

        const result = await req.db.query(query);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// 9- grouped orders
router.post('/orders/group', async (req, res) => {
    try {
        const { groupBy = 'day' } = req.query;
        const validGroups = ['day', 'week', 'month'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            SELECT 
                DATE_TRUNC('day', created_at) AS period, 
                COUNT(order_id) AS total_orders
            FROM orders
            WHERE status = 'completed'
            AND created_at >= DATE_TRUNC($1, CURRENT_DATE) 
            GROUP BY period
            ORDER BY period ASC;
        `;

        const result = await req.db.query(query, [groupBy]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//10 -profit,expense, income grouped

router.post('/grouped/all', async (req, res) => {
    try {
        const { groupBy = 'day' } = req.query;
        const validGroups = ['day', 'week', 'month'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            WITH income AS (
                SELECT 
                    DATE_TRUNC('day', generated_at) AS period, 
                    COALESCE(SUM(total_amount), 0) AS total_income
                FROM (
                    SELECT generated_at, total_amount FROM bills WHERE status = 'paid'
                    UNION ALL
                    SELECT generated_at, total_amount FROM web_bills WHERE status = 'paid'
                ) AS combined_data
                WHERE generated_at >= DATE_TRUNC($1, CURRENT_DATE)
                GROUP BY period
            ),
            expenses AS (
                SELECT 
                    DATE_TRUNC('day', expense_date) AS period, 
                    COALESCE(SUM(amount), 0) AS total_expense
                FROM expenses
                WHERE expense_date >= DATE_TRUNC($1, CURRENT_DATE)
                GROUP BY period
            )
            SELECT 
                COALESCE(i.period, e.period) AS period,
                COALESCE(i.total_income, 0) AS total_income,
                COALESCE(e.total_expense, 0) AS total_expense,
                COALESCE(i.total_income, 0) - COALESCE(e.total_expense, 0) AS total_profit
            FROM income i
            FULL OUTER JOIN expenses e ON i.period = e.period
            ORDER BY period;
        `;

        const result = await req.db.query(query, [groupBy]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


module.exports = router;