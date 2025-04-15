    // src/routes/api/check-username/+server.js
    import { json } from '@sveltejs/kit';

    export async function GET(event) {
        const url = new URL(event.request.url);
        const username = url.searchParams.get('username');
        const clientAddress = event.getClientAddress();

        if (!username) {
            return json({ error: 'Username parameter is required' }, { status: 400 });
        }

        const db = event.platform?.env?.DB;
        if (!db) {
            console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found for username check by ${clientAddress}.`);
            return json({ error: 'Database connection failed' }, { status: 500 });
        }

        console.log(`[${new Date().toISOString()}] Checking username existence: ${username} requested by ${clientAddress}`);

        try {
            // Check if any label exists with this username (case-insensitive check might be better depending on DB collation)
            // Using LOWER() for case-insensitivity, adjust if D1 collation handles it differently.
            const stmt = db.prepare('SELECT id FROM labels WHERE LOWER(username) = LOWER(?) LIMIT 1').bind(username);
            const existingLabel = await stmt.first();

            const exists = !!existingLabel; // Convert result to boolean

            console.log(`[${new Date().toISOString()}] Username '${username}' exists: ${exists}`);
            return json({ exists });

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error checking username ${username} for ${clientAddress}:`, error);
            return json({ error: 'Failed to check username' }, { status: 500 });
        }
    }