import { json } from '@sveltejs/kit';

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
        const totalStmt = db.prepare('SELECT COUNT(*) as total FROM articles');
        const labelledStmt = db.prepare('SELECT COUNT(*) as labelled FROM articles WHERE is_labelled = TRUE');
        
        // D1 batching for read operations
        const [totalResult, labelledResult] = await db.batch([
            totalStmt,
            labelledStmt
        ]);

        // Check results carefully - D1 batch returns arrays
        const total = totalResult?.results?.[0]?.total ?? 0;
        const labelled = labelledResult?.results?.[0]?.labelled ?? 0;
        const unassigned = total - labelled; 

        const results = { total, labelled, unassigned };

        console.log(`[${new Date().toISOString()}] Reporting status:`, results);
        return json(results);

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