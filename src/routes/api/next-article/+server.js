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
            return json({ article: null, limitReached: true, userLabelCount: currentUserCount }, { status: 200 });
        }
        // ----------------------------------

        // --- V4 Query Logic: Random Batch IDs + Targeted Count Checks --- 
        
        // 1. Get IDs already labelled by this user
        const userLabelsStmt = db.prepare('SELECT article_id FROM labels WHERE username = ?1').bind(username);
        const userLabelledResults = await userLabelsStmt.all();
        const userLabelledIds = new Set(userLabelledResults?.results?.map(row => row.article_id) ?? []);
        console.log(`[${new Date().toISOString()}] User ${username} has labelled ${userLabelledIds.size} articles.`);

        // --- NEW Query Logic: Prioritize articles closest to completion ---
        
        let article = null;
        
        // Construct the query to find the best candidate article
        // 1. Count labels for each article.
        // 2. Filter out articles already done (>= REQUIRED_LABELS_PER_ARTICLE).
        // 3. Filter out articles this user has labelled (using WHERE NOT IN).
        // 4. Order by label count DESC (highest count first), then by ID ASC.
        // 5. Limit to 1.
        let prioritizedArticleStmt;
        if (userLabelledIds.size > 0) {
            // Need to handle 'IN' clause parameter binding correctly for multiple IDs
            const placeholders = Array.from(userLabelledIds).map(() => '?').join(',');
            prioritizedArticleStmt = db.prepare(`
                SELECT a.id, a.title, a.alltext, COUNT(l.id) as label_count
                FROM articles a
                LEFT JOIN labels l ON a.id = l.article_id
                GROUP BY a.id, a.title, a.alltext
                HAVING label_count < ?1 
                   AND a.id NOT IN (${placeholders}) 
                ORDER BY label_count DESC, a.id ASC 
                LIMIT 1
            `).bind(REQUIRED_LABELS_PER_ARTICLE, ...userLabelledIds); // Spread the Set into bind parameters
        } else {
             // Simpler query if the user hasn't labelled anything yet
             prioritizedArticleStmt = db.prepare(`
                SELECT a.id, a.title, a.alltext, COUNT(l.id) as label_count
                FROM articles a
                LEFT JOIN labels l ON a.id = l.article_id
                GROUP BY a.id, a.title, a.alltext
                HAVING label_count < ?1
                ORDER BY label_count DESC, a.id ASC
                LIMIT 1
            `).bind(REQUIRED_LABELS_PER_ARTICLE);
        }

        article = await prioritizedArticleStmt.first(); // Returns the full article object or null

        if (article) {
            console.log(`[${new Date().toISOString()}] Selected prioritized article ${article.id} (count: ${article.label_count}) for user ${username}.`);
        } else {
             console.log(`[${new Date().toISOString()}] No suitable article found via prioritized query for user ${username}.`);
        }
        // --- End NEW Query Logic ---

        if (article) {
            // Provide the found article
            // Need to remove the label_count property before sending to frontend if it's not expected
            const { label_count, ...articleToSend } = article; 
            console.log(`[${new Date().toISOString()}] Providing article ID: ${articleToSend.id} to user ${username} from ${clientAddress}`);
            return json({ article: articleToSend, limitReached: false, userLabelCount: currentUserCount }, { status: 200 });
        } else {
            // No suitable article found in the random batch for this user.
            // Check if the *entire project* might be complete.
            console.log(`[${new Date().toISOString()}] No suitable article found in random batch for user ${username}. Checking global status...`);

            let projectComplete = false;
            try {
                // Count total articles (should be 150 or actual count)
                const totalArticlesStmt = db.prepare(`SELECT COUNT(*) as count FROM articles`);
                const totalResult = await totalArticlesStmt.first();
                const totalArticles = totalResult?.count ?? 0;

                if (totalArticles > 0) {
                    // Count articles that have received the required number of labels
                    const completedArticlesStmt = db.prepare(`
                        SELECT COUNT(article_id) as count
                        FROM (
                            SELECT article_id
                            FROM labels
                            GROUP BY article_id
                            HAVING COUNT(id) >= ?1
                        )
                    `).bind(REQUIRED_LABELS_PER_ARTICLE);
                    const completedResult = await completedArticlesStmt.first();
                    const completedArticles = completedResult?.count ?? 0;
                    
                    console.log(`[${new Date().toISOString()}] Global status check: ${completedArticles} / ${totalArticles} articles complete.`);
                    if (completedArticles >= totalArticles) {
                        projectComplete = true;
                    }
                }
            } catch (statusError) {
                console.error(`[${new Date().toISOString()}] Error checking global completion status for user ${username}:`, statusError);
                // Proceed without setting projectComplete flag if status check fails
            }

            // Include count and completion status in response
            return json({ 
                article: null, 
                limitReached: currentUserCount >= MAX_LABELS_PER_USER, 
                userLabelCount: currentUserCount, 
                projectComplete: projectComplete // Add the global completion flag
            }, { status: 200 });
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