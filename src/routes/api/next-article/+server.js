import { json } from '@sveltejs/kit';

const REQUIRED_LABELS_PER_ARTICLE = 5; // Configurable requirement (Changed from 3)
const MAX_LABELS_PER_USER = 15; // Add user limit constant

export async function GET(event) {
    const clientAddress = event.getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = event.platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }
    
    // ---- Get username from request (need to pass it from frontend) ----
    // We assume the frontend will send it as a query parameter for a GET request
    // e.g., /api/next-article?username=user123
    const url = new URL(event.request.url);
    const username = url.searchParams.get('username');

    if (!username) {
        console.warn(`[${new Date().toISOString()}] Missing username parameter from ${clientAddress}.`);
        return json({ error: 'Username parameter is required' }, { status: 400 });
    }
    // ---------------------------------------------------------------------
    
    console.log(`[${new Date().toISOString()}] GET /api/next-article requested by user: ${username} from ${clientAddress}`);
    
    try {
        // --- Check user label count first (use username) --- 
        const countStmt = db.prepare('SELECT COUNT(id) as count FROM labels WHERE username = ?1').bind(username);
        const userLabelCountResult = await countStmt.first();
        const currentUserCount = userLabelCountResult?.count ?? 0; // Get the count

        if (currentUserCount >= MAX_LABELS_PER_USER) {
            console.log(`[${new Date().toISOString()}] User ${username} reached label limit (${MAX_LABELS_PER_USER}). Returning null.`);
            // Include count in response even when limit reached
            return json({ article: null, limitReached: true, userLabelCount: currentUserCount }, { status: 200 });
        }
        // ----------------------------------

        // Find an article that:
        // 1. Has less than REQUIRED_LABELS_PER_ARTICLE labels.
        // 2. Has *not* already been labelled by the *current* user.
        // D1 SQL: Use a subquery to get IDs already labelled by the user.
        const findStmt = db.prepare(`
            SELECT a.id, a.title, a.alltext
            FROM articles a
            LEFT JOIN (
                SELECT article_id, COUNT(id) as label_count 
                FROM labels 
                GROUP BY article_id
            ) lc ON a.id = lc.article_id
            WHERE (lc.label_count IS NULL OR lc.label_count < ?1) -- Condition 1: Less than N labels
              AND a.id NOT IN (SELECT article_id FROM labels WHERE username = ?2) -- Condition 2: Not labelled by this user (using username)
            ORDER BY RANDOM()
            LIMIT 1
        `).bind(REQUIRED_LABELS_PER_ARTICLE, username);

        const article = await findStmt.first();

        if (article) {
            // No longer need versioning here as we are inserting into a separate table
            console.log(`[${new Date().toISOString()}] Providing article ID: ${article.id} to ${clientAddress}`);
            // Include count in response
            return json({ article: article, limitReached: false, userLabelCount: currentUserCount }, { status: 200 });
        } else {
            // No more articles available that meet the criteria for this user
            console.log(`[${new Date().toISOString()}] No more articles to label for user ${username} from ${clientAddress}.`);
            // Include count in response
            return json({ article: null, limitReached: currentUserCount >= MAX_LABELS_PER_USER, userLabelCount: currentUserCount }, { status: 200 });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching next article for ${clientAddress}:`, error);
        return json({ error: 'Failed to fetch next article' }, { status: 500 });
    }
}

// Add a handler for potential OPTIONS requests if needed (CORS)
// export async function OPTIONS() {
//     return new Response(null, {
//         headers: {
//             'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
//             'Access-Control-Allow-Origin': '*', // Adjust as necessary for security
//             'Access-Control-Allow-Headers': 'Content-Type',
//         }
//     });
// } 