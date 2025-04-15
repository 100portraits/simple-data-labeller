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

        // --- V3 Query Logic: Minimize DB work, filter/select in code --- 
        
        // 1. Get IDs already labelled by this user
        const userLabelsStmt = db.prepare('SELECT article_id FROM labels WHERE username = ?1').bind(username);
        const userLabelledResults = await userLabelsStmt.all();
        const userLabelledIds = new Set(userLabelledResults?.results?.map(row => row.article_id) ?? []);
        console.log(`[${new Date().toISOString()}] User ${username} has labelled ${userLabelledIds.size} articles.`);

        // 2. Get counts for all articles that have at least one label
        const labelCountsStmt = db.prepare('SELECT article_id, COUNT(id) as count FROM labels GROUP BY article_id');
        const labelCountsResult = await labelCountsStmt.all();
        const labelCounts = new Map(labelCountsResult?.results?.map(row => [row.article_id, row.count]) ?? []);
        console.log(`[${new Date().toISOString()}] Fetched label counts for ${labelCounts.size} articles.`);

        // 3. Get all article IDs (assuming 150 is small enough to fetch all)
        const allArticleIdsStmt = db.prepare('SELECT id FROM articles');
        const allArticleIdsResult = await allArticleIdsStmt.all();
        const allArticleIds = allArticleIdsResult?.results?.map(row => row.id) ?? [];
        console.log(`[${new Date().toISOString()}] Fetched ${allArticleIds.length} total article IDs.`);

        // 4. Filter in code: Find IDs eligible for this user
        const eligibleArticleIds = allArticleIds.filter(id => {
            const count = labelCounts.get(id) ?? 0;
            return count < REQUIRED_LABELS_PER_ARTICLE && !userLabelledIds.has(id);
        });
        console.log(`[${new Date().toISOString()}] Found ${eligibleArticleIds.length} eligible articles for user ${username}.`);

        let article = null;
        if (eligibleArticleIds.length > 0) {
            // 5. Select one eligible ID randomly in code
            const randomIndex = Math.floor(Math.random() * eligibleArticleIds.length);
            const selectedArticleId = eligibleArticleIds[randomIndex];
            console.log(`[${new Date().toISOString()}] Randomly selected eligible article ID: ${selectedArticleId}`);

            // 6. Fetch the data for the *single selected* article
            const articleStmt = db.prepare('SELECT id, title, alltext FROM articles WHERE id = ?1').bind(selectedArticleId);
            article = await articleStmt.first();
        }
        // --- End V3 Query Logic ---

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