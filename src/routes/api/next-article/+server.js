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

        // 2. Get a batch of random article IDs from the articles table
        const RANDOM_BATCH_SIZE = 20; // Fetch a slightly larger batch of IDs
        const randomIdsStmt = db.prepare(`SELECT id FROM articles ORDER BY RANDOM() LIMIT ?1`).bind(RANDOM_BATCH_SIZE);
        const randomIdsResult = await randomIdsStmt.all();
        const randomArticleIds = randomIdsResult?.results?.map(row => row.id) ?? [];
        console.log(`[${new Date().toISOString()}] Fetched ${randomArticleIds.length} random article IDs to check.`);

        // 3. Iterate and check candidates
        let article = null;
        let selectedArticleId = null;

        for (const candidateId of randomArticleIds) {
            // 3a. Check if user already labelled this (in code)
            if (userLabelledIds.has(candidateId)) {
                console.log(`[${new Date().toISOString()}] Skipping article ${candidateId} (already labelled by user ${username}).`);
                continue; // Skip to next candidate
            }

            // 3b. Check current label count for this specific article (DB query)
            const countCheckStmt = db.prepare('SELECT COUNT(id) as count FROM labels WHERE article_id = ?1').bind(candidateId);
            const countResult = await countCheckStmt.first();
            const currentCount = countResult?.count ?? 0;
            console.log(`[${new Date().toISOString()}] Article ${candidateId} has ${currentCount} labels.`);

            // 3c. Check if count is below threshold
            if (currentCount < REQUIRED_LABELS_PER_ARTICLE) {
                selectedArticleId = candidateId; // Found a suitable article ID
                console.log(`[${new Date().toISOString()}] Selected article ${selectedArticleId} for user ${username}.`);
                break; // Stop searching
            }
        }

        // 4. Fetch article details if an ID was selected
        if (selectedArticleId) {
            const articleStmt = db.prepare('SELECT id, title, alltext FROM articles WHERE id = ?1').bind(selectedArticleId);
            article = await articleStmt.first();
        }
        // --- End V4 Query Logic ---

        if (article) {
            // Provide the found article
            console.log(`[${new Date().toISOString()}] Providing article ID: ${article.id} to ${clientAddress}`);
            return json({ article: article, limitReached: false, userLabelCount: currentUserCount }, { status: 200 });
        } else {
            // No suitable article found in the random batch
            console.log(`[${new Date().toISOString()}] No suitable article found in random batch for user ${username} from ${clientAddress}.`);
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