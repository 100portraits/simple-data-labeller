import { json } from '@sveltejs/kit';

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
        // Find one random article that is not labelled
        const findStmt = db.prepare(`
            SELECT id, title, alltext, version 
            FROM articles 
            WHERE is_labelled = FALSE 
            ORDER BY RANDOM() -- Fetch a random unlabelled row
            LIMIT 1
        `);
            
        const article = await findStmt.first(); // Use .first() with D1

        if (article) {
            console.log(`[${new Date().toISOString()}] Providing article ID: ${article.id} (version: ${article.version}) to ${clientAddress}`);
            return json(article);
        } else {
            // No more articles available
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