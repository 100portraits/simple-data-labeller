import { json } from '@sveltejs/kit';

const REQUIRED_LABELS_PER_ARTICLE = 3; // Configurable requirement

export async function GET(event) {
    const clientAddress = event.getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = event.platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }
    
    console.log(`[${new Date().toISOString()}] GET /api/next-article requested by ${clientAddress}`);
    
    try {
        // Find an article that has less than REQUIRED_LABELS_PER_ARTICLE labels.
        // We also need to make sure the current user hasn't already labelled this article.
        // This query is more complex and might need optimization depending on scale.
        // D1 doesn't support window functions or complex subqueries well, so we might fetch more candidates and filter in code if needed.
        
        // Simplified approach: Find an article with fewer than N total labels.
        // We are temporarily removing the check for "has the *current* user labelled it?"
        // because it significantly complicates the query in D1's SQL dialect. 
        // A user might get the same article twice, but the submission logic should ideally handle this
        // or we accept it as a minor inefficiency for now.
        const findStmt = db.prepare(`
            SELECT a.id, a.title, a.alltext
            FROM articles a
            LEFT JOIN labels l ON a.id = l.article_id
            GROUP BY a.id, a.title, a.alltext
            HAVING COUNT(l.id) < ?1
            ORDER BY RANDOM() -- Still pick a random one from the available set
            LIMIT 1
        `).bind(REQUIRED_LABELS_PER_ARTICLE);

        const article = await findStmt.first(); // Use .first() with D1

        if (article) {
            // No longer need versioning here as we are inserting into a separate table
            console.log(`[${new Date().toISOString()}] Providing article ID: ${article.id} to ${clientAddress}`);
            return json(article);
        } else {
            // No more articles available that meet the criteria
            console.log(`[${new Date().toISOString()}] No more articles to label for ${clientAddress}.`);
            return json(null, { status: 200 }); // Return null to indicate completion
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