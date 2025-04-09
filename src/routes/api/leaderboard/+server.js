import { json } from '@sveltejs/kit';

export async function GET(event) {
    const clientAddress = event.getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = event.platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }
    
    console.log(`[${new Date().toISOString()}] GET /api/leaderboard requested by ${clientAddress}`);

    try {
        // Query to count labelled articles per user
        // Exclude null or empty usernames
        const stmt = db.prepare(`
            SELECT 
                labelled_by_user as username, 
                COUNT(*) as count
            FROM articles 
            WHERE is_labelled = TRUE AND labelled_by_user IS NOT NULL AND labelled_by_user != ''
            GROUP BY labelled_by_user
            ORDER BY count DESC, username ASC -- Order by count descending, then username ascending
        `);
        
        // D1 returns results in a structured object
        const { results: leaderboardData } = await stmt.all();

        const count = leaderboardData?.length ?? 0;
        console.log(`[${new Date().toISOString()}] Found ${count} users on leaderboard for ${clientAddress}.`);
        return json(leaderboardData || []); // Return empty array if results are null/undefined

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching leaderboard data for ${clientAddress}:`, error);
        return json({ error: 'Failed to fetch leaderboard data' }, { status: 500 });
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