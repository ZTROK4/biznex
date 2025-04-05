const express = require('express');
const jwt = require('jsonwebtoken');
const pg = require('pg');
const router = express.Router();
const moment = require('moment');

router.use(async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(400).json({ error: 'No token provided. Please log in first.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.dbname = decoded.dbname; 

        const db = new pg.Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: req.dbname,  
        });

        req.db = db; 
        next(); 
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
});

router.get('/summary/all', async (req, res) => {
    try {
        const incomeQuery = `
            SELECT COALESCE(SUM(total_revenue), 0) AS total_income FROM (
                SELECT SUM(total_amount) AS total_revenue FROM bills 
                WHERE DATE(generated_at) = CURRENT_DATE AND payment_status = 'paid'
                UNION ALL
                SELECT SUM(total_amount) AS total_revenue FROM web_bills 
                WHERE DATE(generated_at) = CURRENT_DATE AND payment_status = 'paid'
                UNION ALL
                SELECT SUM(amount) AS total_revenue FROM man_incomes 
                WHERE DATE(income_date) = CURRENT_DATE
            ) AS combined_income;
        `;

        const expenseQuery = `
            SELECT COALESCE(SUM(amount), 0) AS total_expense
            FROM man_expenses 
            WHERE DATE(expense_date) = CURRENT_DATE;
        `;

        const ordersQuery = `
            SELECT COUNT(*) AS total_orders 
            FROM orders 
            WHERE DATE(created_at) = CURRENT_DATE AND status = 'completed';
        `;

        const profitQuery = `
            WITH income_data AS (
                SELECT 
                    DATE_TRUNC('week', period) AS week_start,
                    SUM(total_amount) AS total_income
                FROM (
                    SELECT generated_at AS period, total_amount FROM bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT generated_at AS period, total_amount FROM web_bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT income_date AS period, amount AS total_amount FROM man_incomes
                ) AS combined_income
                WHERE period >= NOW() - INTERVAL '2 weeks'
                GROUP BY week_start
            ),
            expense_data AS (
                SELECT 
                    DATE_TRUNC('week', expense_date) AS week_start,
                    SUM(amount) AS total_expense
                FROM man_expenses
                GROUP BY week_start
            ),
            profit_data AS (
                SELECT 
                    i.week_start, 
                    COALESCE(i.total_income, 0) - COALESCE(e.total_expense, 0) AS profit
                FROM income_data i
                LEFT JOIN expense_data e
                ON i.week_start = e.week_start
            )
            SELECT 
                COALESCE(
                    ROUND(
                        ((current_week.profit - last_week.profit) / NULLIF(last_week.profit, 0)) * 100,
                        2
                    ), 0
                ) AS percent_change
            FROM 
                (SELECT profit FROM profit_data ORDER BY week_start DESC LIMIT 1) AS current_week
            LEFT JOIN 
                (SELECT profit FROM profit_data ORDER BY week_start DESC OFFSET 1 LIMIT 1) AS last_week
            ON true;
        `;

        const incomeResult = await req.db.query(incomeQuery);
        const expenseResult = await req.db.query(expenseQuery);
        const ordersResult = await req.db.query(ordersQuery);
        const profitResult = await req.db.query(profitQuery);

        const income = incomeResult.rows[0].total_income;
        const expense = expenseResult.rows[0].total_expense;
        const totalOrders = ordersResult.rows[0].total_orders;
        const profitPercentChange = profitResult.rows.length > 0 ? profitResult.rows[0].percent_change : 0;

        const profit = income - expense;
        const incomePercentChange = await getPercentChange(req.db,'income');
        const expensePercentChange = await getPercentChange(req.db,'expense');
        const ordersPercentChange = await getOrdersPercentChange(req.db);

        res.json({
            income: {
                total: income,
                percent_change: incomePercentChange
            },
            expense: {
                total: expense,
                percent_change: expensePercentChange
            },
            orders: {
                total: totalOrders,
                percent_change: ordersPercentChange
            },
            profit: {
                total: profit,
                percent_change: profitPercentChange
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

async function getPercentChange(db, type) {  
    let query;
    if (type === 'income') {
        query = `
            WITH weekly_income AS (
            SELECT 
                DATE_TRUNC('week', period) AS week_start,
                SUM(total_amount) AS total_revenue
            FROM (
                SELECT generated_at AS period, total_amount FROM bills WHERE payment_status = 'paid'
                UNION ALL
                SELECT generated_at AS period, total_amount FROM web_bills WHERE payment_status = 'paid'
                UNION ALL
                SELECT income_date AS period, amount AS total_amount FROM man_incomes
            ) AS combined_data
            WHERE period >= NOW() - INTERVAL '2 weeks'
            GROUP BY week_start
            ORDER BY week_start DESC
            )
            SELECT 
                COALESCE(current_week.total_revenue, 0) AS this_week_revenue,
                COALESCE(last_week.total_revenue, 0) AS last_week_revenue,
                CASE 
                    WHEN COALESCE(last_week.total_revenue, 0) = 0 AND COALESCE(current_week.total_revenue, 0) > 0 THEN 
                        100  -- Show 100% growth if last week was 0
                    WHEN COALESCE(last_week.total_revenue, 0) = 0 THEN 0
                    ELSE ROUND(
                        ((current_week.total_revenue - last_week.total_revenue) / NULLIF(last_week.total_revenue, 0)) * 100,
                        2
                    )
                END AS percent_change
            FROM weekly_income current_week
            LEFT JOIN weekly_income last_week 
            ON current_week.week_start = last_week.week_start + INTERVAL '1 week'
            WHERE current_week.week_start = DATE_TRUNC('week', CURRENT_DATE);

        `;
    } else if (type === 'expense') {
        query = `
           WITH expense_data AS (
            SELECT 
                DATE_TRUNC('week', expense_date) AS week_start, 
                SUM(amount) AS total_expense
            FROM man_expenses
            GROUP BY week_start
            )
            SELECT 
                COALESCE(current_week.total_expense, 0) AS this_week_expense,
                COALESCE(last_week.total_expense, 0) AS last_week_expense,
                CASE 
                    WHEN COALESCE(last_week.total_expense, 0) = 0 AND COALESCE(current_week.total_expense, 0) > 0 THEN 
                        100  -- Show 100% growth if last week was 0
                    WHEN COALESCE(last_week.total_expense, 0) = 0 THEN 0
                    ELSE ROUND(
                        ((current_week.total_expense - last_week.total_expense) / NULLIF(last_week.total_expense, 0)) * 100, 
                        2
                    )
                END AS percent_change
            FROM expense_data current_week
            LEFT JOIN expense_data last_week 
            ON current_week.week_start = last_week.week_start + INTERVAL '1 week'
            WHERE current_week.week_start = DATE_TRUNC('week', CURRENT_DATE);

        `;
    }

    const result = await db.query(query);
    return result.rows.length > 0 ? result.rows[0].percent_change : 0;
}



async function getOrdersPercentChange(db) {
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
            COALESCE(current_week.total_orders, 0) AS this_week_orders, 
            COALESCE(last_week.total_orders, 0) AS last_week_orders,
            CASE 
                WHEN COALESCE(last_week.total_orders, 0) = 0 AND COALESCE(current_week.total_orders, 0) > 0 THEN 
                    100  -- Show 100% growth if last week was 0
                WHEN COALESCE(last_week.total_orders, 0) = 0 THEN 0
                ELSE ROUND(((current_week.total_orders - last_week.total_orders) * 100.0 / NULLIF(last_week.total_orders, 0)), 2)
            END AS percent_change
        FROM current_week, last_week;
    `;
    const result = await db.query(query);
    return result.rows.length > 0 ? result.rows[0].percent_change : 0;
}


//1-income value
router.get('/income/sum/all', async (req, res) => {
    try {
        const query = `
            SELECT COALESCE(SUM(total_revenue), 0) AS total_income FROM (
                SELECT SUM(total_amount) AS total_revenue FROM bills 
                WHERE DATE(generated_at) = CURRENT_DATE AND payment_status = 'paid'
                UNION ALL
                SELECT SUM(total_amount) AS total_revenue FROM web_bills 
                WHERE DATE(generated_at) = CURRENT_DATE AND payment_status = 'paid'
                UNION ALL
                SELECT SUM(amount) AS total_revenue FROM man_incomes 
                WHERE DATE(income_date) = CURRENT_DATE
            ) AS combined_income;
        `;

        const result = await req.db.query(query);
        res.json({ total_income: result.rows[0].total_income });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//2-goruped incomes each day
router.post('/income/group', async (req, res) => {
    try {
        const { groupBy = 'day' } = req.query;
        const validGroups = ['day', 'week', 'month', 'year'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

    
        let dateTrunc;
        switch (groupBy) {
            case 'day':
                dateTrunc = "DATE_TRUNC('hour', period)"; 
                break;
            case 'week':
            case 'month':
                dateTrunc = "DATE_TRUNC('day', period)"; 
                break;
            case 'year':
                dateTrunc = "DATE_TRUNC('month', period)"; 
                break;
            default:
                return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            SELECT 
                ${dateTrunc} AS period, 
                COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM (
                SELECT generated_at AS period, total_amount FROM bills WHERE payment_status = 'paid'
                UNION ALL
                SELECT generated_at AS period, total_amount FROM web_bills WHERE payment_status = 'paid'
                UNION ALL
                SELECT income_date AS period, amount AS total_amount FROM man_incomes
            ) AS combined_data
            WHERE period >= DATE_TRUNC($1, CURRENT_DATE) 
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
                    DATE_TRUNC('week', period) AS week_start,
                    SUM(total_amount) AS total_revenue
                FROM (
                    SELECT generated_at AS period, total_amount FROM bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT generated_at AS period, total_amount FROM web_bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT income_date AS period, amount AS total_amount FROM man_incomes
                ) AS combined_data
                WHERE period >= NOW() - INTERVAL '2 weeks'
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

        // If no rows are found, return 0
        const percentChange = result.rows.length > 0 ? result.rows[0].percent_change : 0;

        res.json({ percent_change: percentChange });
    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "Database query failed" });
    }
});

  
//4- expense value
router.get('/expense/sum/all', async (req, res) => {
    try {
        const query = `
            SELECT COALESCE(SUM(amount), 0) AS total_expense
            FROM (
                SELECT amount FROM man_expenses WHERE DATE(expense_date) = CURRENT_DATE
            ) AS combined_expenses;
        `;

        const result = await req.db.query(query);
        res.json({ total_expense: result.rows[0].total_expense });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});



// 5- grouped expense value 
router.post('/expense/group', async (req, res) => {
    try {
        const { groupBy = 'day' } = req.query;
        const validGroups = ['day', 'week', 'month', 'year'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

     
        let dateTrunc;
        switch (groupBy) {
            case 'day':
                dateTrunc = "DATE_TRUNC('hour', expense_date)"; 
                break;
            case 'week':
                dateTrunc = "DATE_TRUNC('day', expense_date)"; 
                break;
            case 'month':
                dateTrunc = "DATE_TRUNC('day', expense_date)";
                break;
            case 'year':
                dateTrunc = "DATE_TRUNC('month', expense_date)"; 
                break;
            default:
                return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            SELECT 
                ${dateTrunc} AS period, 
                COALESCE(SUM(amount), 0) AS total_expense
            FROM (
                
                SELECT expense_date, amount FROM man_expenses
            ) AS combined_expenses
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
                FROM man_expenses
                GROUP BY week_start
            )
            SELECT 
                COALESCE(current_week.total_expense, 0) AS this_week_expense,
                COALESCE(last_week.total_expense, 0) AS last_week_expense,
                CASE 
                    WHEN COALESCE(last_week.total_expense, 0) = 0 THEN 0
                    ELSE ROUND(
                        ((current_week.total_expense - last_week.total_expense) / NULLIF(last_week.total_expense, 0)) * 100, 
                        2
                    )
                END AS percent_change
            FROM expense_data current_week
            LEFT JOIN expense_data last_week 
            ON current_week.week_start = last_week.week_start + INTERVAL '1 week'
            WHERE current_week.week_start = DATE_TRUNC('week', CURRENT_DATE);
        `;

        const result = await req.db.query(query);

        if (result.rows.length === 0) {
            return res.json({ this_week_expense: 0, last_week_expense: 0, percent_change: 0 });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "Database query failed" });
    }
});




// 7-orders value
router.get('/orders/count', async (req, res) => {
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
router.get('/orders/weekly-change', async (req, res) => {
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
                COALESCE(current_week.total_orders, 0) AS this_week_orders, 
                COALESCE(last_week.total_orders, 0) AS last_week_orders,
                CASE 
                    WHEN COALESCE(last_week.total_orders, 0) = 0 THEN 0
                    ELSE ROUND(((current_week.total_orders - last_week.total_orders) * 100.0 / NULLIF(last_week.total_orders, 0)), 2)
                END AS percent_change
            FROM current_week, last_week;
        `;

        const result = await req.db.query(query);

        if (result.rows.length === 0) {
            return res.json({ this_week_orders: 0, last_week_orders: 0, percent_change: 0 });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "Database query failed" });
    }
});


// 9- grouped orders
router.post('/orders/group', async (req, res) => {
    try {
        const { groupBy } = req.body;
        const validGroups = ['day', 'week', 'month', 'year'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        let interval, startInterval;
        switch (groupBy) {
            case 'day':
                interval = 'hour';
                startInterval = "NOW() - INTERVAL '24 hours'";
                break;
            case 'week':
                interval = 'day';
                startInterval = "NOW() - INTERVAL '6 days'";  
                break;
            case 'month':
                interval = 'day';
                startInterval = "NOW() - INTERVAL '27 days'";  
                break;
            case 'year':
                interval = 'month';
                startInterval = "DATE_TRUNC('year', CURRENT_DATE)"; 
                break;
        }

        const query = `
            WITH periods AS (
                SELECT generate_series(
                    ${startInterval}, CURRENT_TIMESTAMP, INTERVAL '1 ${interval}'
                ) AS period
            )
            SELECT 
                p.period,
                COALESCE(COUNT(o.order_id), 0) AS total_orders
            FROM periods p
            LEFT JOIN orders o 
                ON DATE_TRUNC('${interval}', o.created_at) = p.period
                AND o.status = 'completed'
            GROUP BY p.period
            ORDER BY p.period ASC;
        `;

        const result = await req.db.query(query);
        
        const allPeriods = [];
        let currentDate;
        
        if (groupBy === 'year') {
            currentDate = moment().startOf('year');  
        } else if (groupBy === 'month') {
            currentDate = moment().subtract(27, 'days');
        } else if (groupBy === 'week') {
            currentDate = moment().subtract(6, 'days');
        } else {
            currentDate = moment().subtract(24, 'hours');
        }

        const endDate = moment();

        while (currentDate.isSameOrBefore(endDate, groupBy === 'year' ? 'month' : 'day')) {
            allPeriods.push({
                period: currentDate.toISOString(),
                total_orders: 0,
                label: formatLabel(currentDate, groupBy)
            });
            currentDate.add(1, groupBy === 'year' ? 'month' : 'day'); 
        }

        const formattedData = allPeriods.map(periodData => {
            const matchingRow = result.rows.find(row => moment(row.period).isSame(periodData.period, groupBy === 'year' ? 'month' : 'day'));
            return {
                period: periodData.period,
                total_orders: matchingRow ? matchingRow.total_orders : 0,
                label: periodData.label
            };
        });

        res.json(formattedData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});





//10 -profit,expense, income grouped



router.post('/grouped/all', async (req, res) => {
    try {
        const { groupBy } = req.body;
        console.log(`📲 Sent OTP to ${groupBy}: ${groupBy}`);
        const validGroups = ['day', 'week', 'month', 'year'];

        if (!validGroups.includes(groupBy)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        let interval, startInterval;

        switch (groupBy) {
            case 'day':
                interval = 'hour';
                startInterval = "CURRENT_TIMESTAMP - INTERVAL '24 hours'"; 
                break;
            case 'week':
                interval = 'day'; 
                startInterval = "CURRENT_TIMESTAMP - INTERVAL '6 days'";  
                break;
            case 'month':
                interval = 'day'; 
                startInterval = "CURRENT_TIMESTAMP - INTERVAL '27 days'"; 
                break;
            case 'year':
                interval = 'month'; 
                startInterval = "DATE_TRUNC('year', CURRENT_DATE)";
                break;
        }

        const query = `
            WITH periods_cte AS (
                SELECT generate_series(
                    ${startInterval}, CURRENT_TIMESTAMP, INTERVAL '1 ${interval}'
                ) AS period
            ),
            income AS (
                SELECT 
                    DATE_TRUNC('${interval}', generated_at) AS period, 
                    COALESCE(SUM(total_amount), 0) AS total_income
                FROM (
                    SELECT generated_at, total_amount FROM bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT generated_at, total_amount FROM web_bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT income_date AS generated_at, amount AS total_amount FROM man_incomes
                ) AS combined_income
                WHERE generated_at >= ${startInterval}
                GROUP BY period
            ),
            expenses AS (
                SELECT 
                    DATE_TRUNC('${interval}', expense_date) AS period, 
                    COALESCE(SUM(amount), 0) AS total_expense
                FROM man_expenses
                WHERE expense_date >= ${startInterval}
                GROUP BY period
            )
            SELECT 
                p.period,
                COALESCE(i.total_income, 0) AS total_income,
                COALESCE(e.total_expense, 0) AS total_expense,
                COALESCE(i.total_income, 0) - COALESCE(e.total_expense, 0) AS total_profit
            FROM periods_cte p
            LEFT JOIN income i ON DATE_TRUNC('${interval}', p.period) = i.period
            LEFT JOIN expenses e ON DATE_TRUNC('${interval}', p.period) = e.period
            ORDER BY p.period;
        `;

        const result = await req.db.query(query);

        const allPeriods = [];
        let currentDate;

        if (groupBy === 'year') {
            currentDate = moment().startOf('year');  
        } else if (groupBy === 'month') {
            currentDate = moment().subtract(27, 'days').startOf('day'); 
        } else if (groupBy === 'week') {
            currentDate = moment().subtract(6, 'days').startOf('day'); 
        } else {
            currentDate = moment().subtract(24, 'hours'); 
        }

        const endDate = moment();

        while (currentDate.isSameOrBefore(endDate, groupBy === 'year' ? 'month' : 'day')) {
            allPeriods.push({
                period: currentDate.toISOString(),
                total_income: 0,
                total_expense: 0,
                total_profit: 0,
                label: formatLabel(currentDate, groupBy)
            });
            currentDate.add(1, groupBy === 'year' ? 'month' : 'day'); 
        }

        const formattedData = allPeriods.map(periodData => {
            const matchingRow = result.rows.find(row => moment(row.period).isSame(periodData.period, groupBy === 'year' ? 'month' : 'day'));
            return {
                period: periodData.period,
                total_income: matchingRow ? matchingRow.total_income : 0,
                total_expense: matchingRow ? matchingRow.total_expense : 0,
                total_profit: matchingRow ? matchingRow.total_profit : 0,
                label: periodData.label
            };
        });

        res.json(formattedData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

function formatLabel(date, groupBy) {
    const momentDate = moment(date);
    if (groupBy === 'day') {
        return momentDate.format('h A'); 
    } else if (groupBy === 'week' || groupBy === 'month') {
        if (momentDate.isSame(moment(), 'day')) return 'Today';
        if (momentDate.isSame(moment().subtract(1, 'day'), 'day')) return 'Yesterday';
        return momentDate.format('MMM D'); 
    } else if (groupBy === 'year') {
        return momentDate.format('MMM'); 
    }
}




// 11 - profit percent change week
router.get('/profit/percent-change', async (req, res) => {
    try {
        const query = `
            WITH income_data AS (
                SELECT 
                    DATE_TRUNC('week', period) AS week_start,
                    SUM(total_amount) AS total_income
                FROM (
                    SELECT generated_at AS period, total_amount FROM bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT generated_at AS period, total_amount FROM web_bills WHERE payment_status = 'paid'
                    UNION ALL
                    SELECT income_date AS period, amount AS total_amount FROM man_incomes
                ) AS combined_income
                WHERE period >= NOW() - INTERVAL '2 weeks'
                GROUP BY week_start
            ),
            expense_data AS (
                SELECT 
                    DATE_TRUNC('week', expense_date) AS week_start,
                    SUM(amount) AS total_expense
                FROM (
                    SELECT expense_date, amount FROM man_expenses
                ) AS combined_expenses
                WHERE expense_date >= NOW() - INTERVAL '2 weeks'
                GROUP BY week_start
            ),
            profit_data AS (
                SELECT 
                    i.week_start, 
                    COALESCE(i.total_income, 0) - COALESCE(e.total_expense, 0) AS profit
                FROM income_data i
                LEFT JOIN expense_data e
                ON i.week_start = e.week_start
            )
            SELECT 
                COALESCE(
                    ROUND(
                        ((current_week.profit - last_week.profit) / NULLIF(last_week.profit, 0)) * 100,
                        2
                    ), 0
                ) AS percent_change
            FROM 
                (SELECT profit FROM profit_data ORDER BY week_start DESC LIMIT 1) AS current_week
            LEFT JOIN 
                (SELECT profit FROM profit_data ORDER BY week_start DESC OFFSET 1 LIMIT 1) AS last_week
            ON true;
        `;

        const result = await req.db.query(query);

   
        const percentChange = result.rows.length > 0 ? result.rows[0].percent_change : 0;

        res.json({ percent_change: percentChange });

    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "Database query failed" });
    }
});





module.exports = router;