import { json } from '@sveltejs/kit';

const MAX_LABELS_PER_USER = 15; // New user limit

export async function POST(event) {
    const clientAddress = event.getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = event.platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }

    let requestData;
    try {
        requestData = await event.request.json();
    } catch (e) {
        console.error(`[${new Date().toISOString()}] Invalid JSON received from ${clientAddress}:`, e);
        return json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { articleId, username, rating, is_roaddanger } = requestData;
    const roaddangerFlag = is_roaddanger === true ? 1 : 0; // Convert boolean to 0 or 1

    // Validate input
    if (!articleId || !username || rating === undefined || rating === null) {
        console.warn(`[${new Date().toISOString()}] Invalid submission data from ${clientAddress}:`, requestData);
        return json({ error: 'Missing required fields: articleId, username, rating' }, { status: 400 });
    }
    
    const validRatings = [1, 2, 3, 4, 'Not sure']; // Allowed rating values
    if (!validRatings.includes(rating)) {
        console.warn(`[${new Date().toISOString()}] Invalid rating value from ${clientAddress}: ${rating}`);
        return json({ error: 'Invalid rating value' }, { status: 400 });
    }

    console.log(`[${new Date().toISOString()}] Received label submission for article ${articleId} by ${username} with rating ${rating} from ${clientAddress}`);

    try {
        // --- Check user limit (use username) --- 
        const countStmt = db.prepare('SELECT COUNT(id) as count FROM labels WHERE username = ?1').bind(username);
        const userLabelCount = await countStmt.first();
        if (userLabelCount && userLabelCount.count >= MAX_LABELS_PER_USER) {
            console.warn(`[${new Date().toISOString()}] User ${username} has reached the limit of ${MAX_LABELS_PER_USER} labels. Submission rejected.`);
            return json({ error: `You have reached the maximum limit of ${MAX_LABELS_PER_USER} submitted labels.` }, { status: 403 }); // 403 Forbidden
        }
        // --------------------------------------------------

        // Prepare data for insertion
        let ratingValue = null;
        let ratingText = null;
        if (rating === 'Not sure') {
            ratingText = 'Not sure';
        } else {
            ratingValue = parseInt(rating, 10); // Store numbers as integers
            if (isNaN(ratingValue)) { // Double check conversion
                 console.warn(`[${new Date().toISOString()}] Failed to parse numeric rating ${rating} from ${clientAddress}`);
                 return json({ error: 'Invalid numeric rating value' }, { status: 400 });
            }
        }

        // Check if this user has already labelled this specific article (use username)
        const checkStmt = db.prepare(`
            SELECT id FROM labels WHERE article_id = ?1 AND username = ?2
        `).bind(articleId, username);
        const existingLabel = await checkStmt.first();

        if (existingLabel) {
            console.warn(`[${new Date().toISOString()}] User ${username} already labelled article ${articleId}. Submission rejected.`);
            // Return success to avoid blocking the user, but don't insert again
            // Alternatively, return a specific status code or error message if preferred
            return json({ message: 'Already labelled' }, { status: 200 }); 
        }

        // Insert the new label (Removed userSessionId)
        const insertStmt = db.prepare(`
            INSERT INTO labels (article_id, username, rating, rating_text, roaddanger_volunteer) 
            VALUES (?1, ?2, ?3, ?4, ?5)
        `).bind(articleId, username, ratingValue, ratingText, roaddangerFlag);

        await insertStmt.run();

        console.log(`[${new Date().toISOString()}] Successfully inserted label for article ${articleId} by ${username} from ${clientAddress}`);
        return json({ success: true }, { status: 201 }); // 201 Created

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error submitting label for article ${articleId} by ${username} from ${clientAddress}:`, error);
        // Check for potential foreign key constraint errors (e.g., invalid articleId)
        if (error.message?.includes('FOREIGN KEY constraint failed')) {
             return json({ error: 'Invalid article ID' }, { status: 400 });
        }
        return json({ error: 'Failed to submit label' }, { status: 500 });
    }
}

// Optional: Add OPTIONS handler if needed for CORS
// export async function OPTIONS() { ... } 