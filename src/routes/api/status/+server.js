import { json } from '@sveltejs/kit';

const REQUIRED_LABELS_PER_ARTICLE = 3; // Must match next-article config

export async function GET(event) {
    const clientAddress = event.getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = event.platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }

    console.log(`[${new Date().toISOString()}] GET /api/status requested by ${clientAddress}`);

    try {
        // Count total articles
        const totalArticlesStmt = db.prepare(`SELECT COUNT(*) as count FROM articles`);
        const totalResult = await totalArticlesStmt.first();
        const totalArticles = totalResult?.count ?? 0;

        // Count total labels submitted
        const totalLabelsStmt = db.prepare(`SELECT COUNT(*) as count FROM labels`);
        const labelsResult = await totalLabelsStmt.first();
        const totalLabelsSubmitted = labelsResult?.count ?? 0;

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
        
        // Calculate unassigned (more complex, requires knowing total * slots available)
        // Simplified: Calculate remaining labels needed until all articles have N labels
        const totalLabelSlots = totalArticles * REQUIRED_LABELS_PER_ARTICLE;
        const remainingLabelsNeeded = Math.max(0, totalLabelSlots - totalLabelsSubmitted);
        // Estimate unassigned articles (those not yet fully labelled)
        const unassignedArticles = totalArticles - completedArticles;

        const progress = {
            total: totalArticles,       // Total unique articles
            labelled: completedArticles, // Articles with N or more labels
            unassigned: unassignedArticles, // Articles with < N labels
            totalLabelsSubmitted: totalLabelsSubmitted, // Total individual labels submitted
            requiredPerArticle: REQUIRED_LABELS_PER_ARTICLE,
            remainingLabelsNeeded: remainingLabelsNeeded // Total labels still needed
        };
        
        console.log(`[${new Date().toISOString()}] Status for ${clientAddress}:`, progress);
        return json(progress);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching status for ${clientAddress}:`, error);
        return json({ error: 'Failed to fetch database status' }, { status: 500 });
    }
}

// Add a handler for potential OPTIONS requests if needed (CORS)
// export async function OPTIONS() {
//     return new Response(null, {
//         headers: {
//             'Access-Control-Allow-Methods': 'GET, OPTIONS',
//             'Access-Control-Allow-Origin': '*', // Adjust as necessary for security
//             'Access-Control-Allow-Headers': 'Content-Type',
//         }
//     });
// }