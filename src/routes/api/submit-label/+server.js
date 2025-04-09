import { json } from '@sveltejs/kit';

export async function POST({ request, platform, getClientAddress }) {
    const clientAddress = getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }

    console.log(`[${new Date().toISOString()}] POST /api/submit-label received from ${clientAddress}`);
    let requestBody = {}; // Define outside try block for logging in catch

    try {
        requestBody = await request.json();
        const {
            id,
            username,
            version,
            label_human_centered,
            label_active_voice,
            label_crash_vs_accident,
            label_human_story
        } = requestBody;

        console.log(`[${new Date().toISOString()}] Received labels for ID: ${id} (version: ${version}) from user: ${username}`, requestBody);

        // Basic validation
        if (version === undefined || typeof version !== 'number') {
            console.error(`[${new Date().toISOString()}] Invalid submission data from ${clientAddress} (user: ${username}): Missing or invalid version`, requestBody);
            return json({ error: 'Missing or invalid article version' }, { status: 400 });
        }
        if (!username || !username.trim()) {
            console.error(`[${new Date().toISOString()}] Invalid submission data from ${clientAddress}: Missing or empty username`, requestBody);
            return json({ error: 'Username is required' }, { status: 400 });
        }
        if (id === undefined || label_human_centered === undefined || label_active_voice === undefined || label_crash_vs_accident === undefined || label_human_story === undefined) {
            console.error(`[${new Date().toISOString()}] Invalid submission data from ${clientAddress} (user: ${username}): Missing fields`, requestBody);
            return json({ error: 'Missing required label fields' }, { status: 400 });
        }

        // Ensure labels are 0 or 1
        const labels = [
            parseInt(label_human_centered, 10),
            parseInt(label_active_voice, 10),
            parseInt(label_crash_vs_accident, 10),
            parseInt(label_human_story, 10)
        ];
        if (labels.some(label => ![0, 1].includes(label) || isNaN(label))) {
             console.error(`[${new Date().toISOString()}] Invalid label values from ${clientAddress} (user: ${username}):`, labels, `Raw:`, requestBody);
             return json({ error: 'Invalid label value. Must be 0 or 1.' }, { status: 400 });
        }

        // Clean the username (basic trim)
        const cleanedUsername = username.trim();

        // Use D1 directly - D1 client handles transactions implicitly for single statements
        // or requires explicit batching API for multi-statement transactions.
        // For a single UPDATE, no explicit transaction needed here.
        const updateStmt = db.prepare(`
            UPDATE articles
            SET 
                is_labelled = TRUE,
                label_human_centered = ?,
                label_active_voice = ?,
                label_crash_vs_accident = ?,
                label_human_story = ?,
                labelled_by_user = ?, 
                version = version + 1 
            WHERE id = ? AND version = ? 
        `);

        const info = await updateStmt.bind(
            labels[0], labels[1], labels[2], labels[3], // labels first
            cleanedUsername, // user
            id, // articleId
            version // expectedVersion
        ).run(); // Use .run() with D1

        // D1 run() result structure is different, check success/meta
        if (info.success && info.meta?.changes > 0) { 
            console.log(`[${new Date().toISOString()}] Labels submitted successfully for article ID: ${id} (new version: ${version + 1}) by user: ${cleanedUsername} (${clientAddress})`);
            return json({ success: true, message: 'Labels submitted successfully' });
        } else { 
            // Check current status from DB if update failed
            const checkStmt = db.prepare('SELECT id, is_labelled, labelled_by_user, version FROM articles WHERE id = ?');
            const articleStatus = await checkStmt.bind(id).first(); 
            
            let failureReason = 'Article not found';
            let statusCode = 404; // Default to Not Found
            if (articleStatus) {
                 failureReason = articleStatus.is_labelled 
                                ? `Article already labelled by ${articleStatus.labelled_by_user || 'unknown'} (version ${articleStatus.version})` 
                                : `Version mismatch (DB version: ${articleStatus.version}, Submitted version: ${version})`;
                 statusCode = 409; // It exists, so it must be a conflict
            }
            
            console.warn(`[${new Date().toISOString()}] Failed to submit labels for ID ${id} by user ${cleanedUsername} (${clientAddress}). Reason: ${failureReason}. DB Status:`, articleStatus, 'Update Info:', info); 
            return json(
                { 
                    error: `Failed to submit labels. ${failureReason}. Please refresh and try a different article.`, 
                    status: articleStatus 
                }, 
                { status: statusCode } 
            );
        }

    } catch (error) {
        if (error instanceof SyntaxError) { // Handle potential JSON parsing errors
             console.error(`[${new Date().toISOString()}] Error parsing request body from ${clientAddress}:`, error);
             return json({ error: 'Invalid request body' }, { status: 400 });
        } 
        console.error(`[${new Date().toISOString()}] Error submitting labels for ${clientAddress}. Request body:`, requestBody, 'Error:', error);
        return json({ error: 'Internal server error while submitting labels' }, { status: 500 });
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