import { json } from '@sveltejs/kit';

export async function GET(event) {
    const clientAddress = event.getClientAddress();
    const db = event.platform?.env?.DB;

    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }

    const url = new URL(event.request.url);
    const username = url.searchParams.get('username');

    if (!username) {
        console.warn(`[${new Date().toISOString()}] Missing username parameter from ${clientAddress}.`);
        return json({ error: 'Username parameter is required' }, { status: 400 });
    }

    console.log(`[${new Date().toISOString()}] GET /api/user-progress requested by user: ${username} from ${clientAddress}`);

    try {
        const countStmt = db.prepare('SELECT COUNT(id) as count FROM labels WHERE username = ?1').bind(username);
        const result = await countStmt.first();
        const count = result?.count ?? 0;

        console.log(`[${new Date().toISOString()}] User ${username} count is ${count}.`);
        return json({ count });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching user progress for ${username} from ${clientAddress}:`, error);
        return json({ error: 'Failed to fetch user progress' }, { status: 500 });
    }
} 