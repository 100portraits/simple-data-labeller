<script>
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment'; // Import browser check

    const MAX_LABELS_PER_USER = 15; // Define limit for frontend message

    let currentArticle = null;
    let isLoading = true;
    let error = null;
    let allDone = false;
    let submitting = false;
    let userLimitReached = false; // New state for user limit
    let isRoadDangerVolunteer = false; // Flag for special volunteers

    // --- User Identification ---
    let username = '';
    let needsUsernameSetup = false; // Control modal visibility
    let modalUsernameInput = ''; // Separate state for modal input
    let modalError = null; // Error message within the modal

    // --- Progress Tracking ---
    let progress = { total: 0, labelled: 0, unassigned: 0 };
    let isLoadingProgress = true;
    let progressError = null;
    let intervalId = null; // For polling progress

    // --- Leaderboard State ---
    let showLeaderboard = false;
    let leaderboardData = [];
    let isLoadingLeaderboard = false;
    let leaderboardError = null;

    // Single label state for the current article
    let currentRating = null; // Holds 1, 2, 3, 4, or "Not sure"

    // --- Functions ---

    // Function to fetch the next article
    async function fetchNextArticle() {
        console.log('Attempting to fetch next article...');
        isLoading = true;
        error = null;
        currentArticle = null;
        allDone = false;
        userLimitReached = false; // Reset limit flag on fetch attempt
        currentRating = null; // Reset the rating for the new article

        if (!username) {
            console.warn('Cannot fetch next article: Username not set.');
            error = 'Username not set. Please refresh.'; // Should not happen if modal works
            isLoading = false;
            return;
        }

        try {
            // Pass username as a query parameter
            const response = await fetch(`/api/next-article?username=${encodeURIComponent(username)}`);
            console.log('Fetch response status:', response.status);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
            }
            // Expect { article: {...} | null, limitReached: boolean }
            const data = await response.json(); 

            if (data.limitReached) {
                console.log(`User ${username} has reached the label limit.`);
                userLimitReached = true;
                allDone = false; // Not all done, just this user
                currentArticle = null;
            } else if (data.article) {
                console.log(`Fetched article ID: ${data.article.id}`);
                currentArticle = data.article;
            } else {
                console.log('All articles are labelled or no more available for this user.');
                allDone = true; // No more articles
                await fetchProgress(); // Update progress one last time
            }
        } catch (e) {
            console.error('Failed to fetch article:', e);
            error = 'Failed to load the next article. Please try refreshing the page.';
        } finally {
            isLoading = false;
            console.log('Finished fetching article attempt.');
        }
    }

    // Function to submit the labels
    async function submitLabels() {
        if (!username) {
            console.error('Submission blocked: Username not set.');
            // This case should ideally not happen if modal logic is correct
            alert('Error: Username not set. Please refresh.');
            return;
        }

        if (!currentArticle || submitting) {
            console.log('Submission skipped (no article or already submitting)');
            return;
        }

        if (currentRating === null) {
            console.warn('Submission blocked: Rating not selected.');
            alert(`Please select a rating (1-4 or Not sure).`);
            return;
        }

        console.log(`Attempting to submit label for article ID: ${currentArticle.id} by user: ${username} with rating: ${currentRating}`);
        submitting = true;
        error = null;
        const submittedId = currentArticle.id; 

        try {
            const response = await fetch('/api/submit-label', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articleId: submittedId, // Changed from id
                    username: username,
                    rating: currentRating, // Send the single rating
                    is_roaddanger: isRoadDangerVolunteer // Send the flag
                })
            });
            
            console.log('Submit response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Could not parse error response.' })); 
                // Status 409 conflict is no longer expected with the new logic (no version check)
                // Check for potential duplicate submission message (status 200 with { message: 'Already labelled' })
                 if (response.status === 200 && errorData.message === 'Already labelled') {
                    console.warn(`User ${username} already labelled article ${submittedId}. Fetching next.`);
                    error = 'You have already submitted a rating for this article. Fetching the next one.';
                    // Still fetch next article even if it was a duplicate submission attempt
                    await Promise.all([
                        fetchNextArticle(),
                        fetchProgress()
                    ]);
                } else {
                    // Check for user limit reached error (status 403)
                    if (response.status === 403) {
                        console.warn(`User ${username} reached label limit. Server rejected submission.`);
                        userLimitReached = true; // Set limit flag
                        currentArticle = null; // Clear article
                        error = errorData.error || `You have reached the maximum limit of ${MAX_LABELS_PER_USER} labels.`;
                    } else {
                        throw new Error(`Submit failed: ${response.status} ${response.statusText}. ${errorData.error || 'Unknown server error'}`);
                    }
                }
            } else {
                console.log(`Labels submitted successfully for article ID: ${submittedId} by ${username}`);
                // Submission successful, fetch the next article AND update progress
                await Promise.all([
                    fetchNextArticle(),
                    fetchProgress()
                ]);
                // If leaderboard is showing, refresh it too
                if (showLeaderboard) {
                    fetchLeaderboard(); // No await needed, can refresh in background
                }
            }

        } catch (e) {
            console.error(`Failed to submit labels for article ID: ${submittedId}`, e);
            error = `Submission failed: ${e.message}. Please check the console and try again.`;
        } finally {
            submitting = false;
            console.log(`Finished submitting attempt for article ID: ${submittedId}`);
        }
    }

    // Function to reset labels (now just one rating)
    function resetLabels() {
        console.log('Resetting rating');
        currentRating = null;
    }

    // Function to fetch and display labelled articles
    // async function toggleLabelledTable() { ... }

    // --- New Functions ---

    // Function to confirm username from modal
    function confirmUsername() {
        modalError = null;
        const trimmedUser = modalUsernameInput.trim();
        if (!trimmedUser) {
            modalError = 'Username cannot be empty.';
            console.warn('Username confirmation failed: empty input.');
            return;
        }
        username = trimmedUser; // Set the main username state
        if (browser) {
            try {
                localStorage.setItem('labellerUsername', username); // Save to local storage
                console.log('Username saved:', username);
                needsUsernameSetup = false; // Hide the modal

                // ---- ADDED: Start fetching data now that username is set ----
                console.log('Username confirmed, fetching initial data...');
                isLoading = true; // Show loading indicators again
                isLoadingProgress = true;
                fetchNextArticle();
                fetchProgress();
                // Start polling if not already started (shouldn't be, but safe check)
                if (!intervalId) {
                    intervalId = setInterval(fetchProgress, 30000); 
                    console.log('Progress polling started after username setup.');
                }
                // -------------------------------------------------------------

            } catch (storageError) {
                console.error('Failed to save username to local storage:', storageError);
                modalError = 'Could not save username. Please ensure cookies/site data are enabled.';
            }
        }
    }

    // Function to fetch progress status
    async function fetchProgress() {
        console.log('Fetching progress status...');
        isLoadingProgress = true;

        try {
            const response = await fetch('/api/status');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
            }
            progress = await response.json();
            // Example: Display total labels submitted if needed
            console.log(`Total individual labels submitted: ${progress.totalLabelsSubmitted}`);
            progressError = null; // Clear error on success
            console.log('Progress status updated:', progress);
        } catch (e) {
            console.error('Failed to fetch progress status:', e);
            progressError = 'Failed to load progress. Retrying...';
        } finally {
            isLoadingProgress = false;
        }
    }

    // Function to fetch and display leaderboard
    async function fetchLeaderboard() {
        console.log('Fetching leaderboard...');
        isLoadingLeaderboard = true;
        leaderboardError = null;
        leaderboardData = [];

        try {
            const response = await fetch('/api/leaderboard');
            console.log('Fetch leaderboard response status:', response.status);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
            }
            leaderboardData = await response.json();
            console.log(`Fetched ${leaderboardData.length} users for leaderboard.`);
        } catch (e) {
            console.error('Failed to fetch leaderboard:', e);
            leaderboardError = 'Failed to load leaderboard. Please try again.';
        } finally {
            isLoadingLeaderboard = false;
        }
    }

    // Toggle leaderboard visibility and fetch data if needed
    function toggleLeaderboard() {
        if (showLeaderboard) {
            showLeaderboard = false;
            console.log('Hiding leaderboard.');
            return;
        }

        // --- Ensure other panel is closed (REMOVED labelled table check) --- 
        // if (showLabelledTable) {
        //     showLabelledTable = false;
        //     console.log('Closing labelled articles to show leaderboard.');
        // }
        // ------------------------------------

        showLeaderboard = true; // Show immediately, content will load
        console.log('Showing leaderboard.');
        // Fetch data if needed (or maybe always refresh?)
        if (leaderboardData.length === 0 || !isLoadingLeaderboard) { // Fetch if empty or not already loading
            fetchLeaderboard();
        }
    }

    // --- Lifecycle Hooks ---
    onMount(() => {
        console.log('Labeller page mounted.');
        if (browser) {
            // --- Check for special source parameter --- 
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('source') === 'roaddanger') {
                isRoadDangerVolunteer = true;
                console.log('Road Danger volunteer source detected.');
            }
            // ------------------------------------------

            // Load username from local storage
            const storedUsername = localStorage.getItem('labellerUsername');
            if (storedUsername) {
                username = storedUsername;
                console.log('Username loaded from storage:', username);
                needsUsernameSetup = false;
            } else {
                console.log('No username found in storage. Prompting user.');
                needsUsernameSetup = true; // Show modal if no username is stored
            }
        } else {
            // SSR or environment without browser APIs
            needsUsernameSetup = true; // Assume setup needed if no browser context
        }
        
        // Fetch initial data only if username setup is not needed immediately
        if (!needsUsernameSetup) {
            fetchNextArticle();
            fetchProgress();
            // Poll for progress updates every 30 seconds
            intervalId = setInterval(fetchProgress, 30000); 
        } else {
             isLoading = false; // Stop main loading indicator if modal is shown
             isLoadingProgress = false; // Also stop progress loading
        }
    });

    onDestroy(() => {
        // Clear the interval when the component is destroyed
        if (intervalId) {
            clearInterval(intervalId);
            console.log('Progress polling stopped.');
        }
    });

</script>

<svelte:head>
    <title>Article Labeller</title>
</svelte:head>

<main>
    {#if needsUsernameSetup}
        <!-- Username Setup Modal -->
        <div class="modal-overlay">
            <div class="modal-content">
                <h2>Welcome! Please enter your name:</h2>
                <p>This name will be used to track your contributions.</p>
                <input 
                    type="text" 
                    bind:value={modalUsernameInput} 
                    placeholder="Your Name"
                    aria-label="Enter your name"
                    aria-describedby={modalError ? "modal-error" : undefined}
                    required
                    on:keydown={(e) => e.key === 'Enter' && confirmUsername()}
                >
                {#if modalError}
                    <p id="modal-error" class="modal-error">{modalError}</p>
                {/if}
                <button on:click={confirmUsername} class="modal-confirm-button">Start Labelling</button>
            </div>
        </div>
    {/if}
    <div class:blurred={needsUsernameSetup}> <!-- Blur background if modal is active -->
        <header class="status-header">
            <!-- Display Username -->
            <div class="username-display">
                {#if username}
                    <span>Welcome, <strong>{username}</strong>!</span>
                {/if}
            </div>

            <!-- Progress Meter -->
            <div class="progress-meter">
                {#if isLoadingProgress && !needsUsernameSetup} <!-- Only show loading if modal not active -->
                    <span>Loading progress...</span>
                {:else if progressError}
                    <span class="error-inline">{progressError}</span>
                {:else if progress.total > 0} <!-- Check if total articles > 0 -->
                    <span>Progress: {progress.labelled} / {progress.total} Articles Completed ({progress.requiredPerArticle} labels each)</span>
                    <progress value={progress.labelled} max={progress.total}></progress> 
                    <span>({progress.unassigned} articles remaining, {progress.totalLabelsSubmitted} total labels submitted)</span>
                {:else if !needsUsernameSetup} <!-- Dont show if modal active -->
                    <span>Progress data unavailable.</span>
                {/if}
            </div>
        </header>

        <h1>Article Labeller</h1>

        <!-- Main Labelling Area -->
        {#if isLoading && !needsUsernameSetup} <!-- Only show loading if modal not active -->
            <p>Loading next article...</p>
        {:else if userLimitReached}
            <p style="color: blue; font-weight: bold; text-align: center; margin: 2rem 0;">
                You've labelled {MAX_LABELS_PER_USER} articles. We're asking only {MAX_LABELS_PER_USER} from each person so that we get a diversity of responses. Thank you!
            </p>
        {:else if allDone}
            <p style="color: green; font-weight: bold; text-align: center; margin: 2rem 0;">All articles have been labelled! Thank you!</p>
        {:else if currentArticle}
            <article>
                <h2>({currentArticle.id}) {currentArticle.title}</h2>
                <div class="article-text">
                    <p>{currentArticle.alltext}</p>
                </div>
                
                <form on:submit|preventDefault={submitLabels}>
                    <fieldset>
                        <legend>Dehumanization Rating</legend>
                        <p>
                            Traffic crashes are events that involve real people and have human consequences. 
                            News articles can report on these events in ways that either highlight or minimize these human aspects.
                            <br/>After reading this article about a traffic crash, please rate it on the following scale:
                        </p>
                        
                        <label>
                            <input type="radio" bind:group={currentRating} name="dehumanization_rating" value={1}> 
                            1 - Strongly dehumanizing: The article treats the crash as a technical incident with little acknowledgment of human involvement or impact.
                        </label>
                        <label>
                            <input type="radio" bind:group={currentRating} name="dehumanization_rating" value={2}> 
                            2 - Somewhat dehumanizing
                        </label>
                         <label>
                            <input type="radio" bind:group={currentRating} name="dehumanization_rating" value={3}> 
                            3 - Somewhat humanizing
                        </label>
                         <label>
                            <input type="radio" bind:group={currentRating} name="dehumanization_rating" value={4}> 
                            4 - Strongly humanizing: The article clearly acknowledges the people involved and the human impact of the crash.
                        </label>
                        <label>
                            <input type="radio" bind:group={currentRating} name="dehumanization_rating" value={"Not sure"}> 
                            Not sure
                        </label>
                    </fieldset>

                    {#if error}
                        <p class="error">Error: {error}</p>
                    {/if}

                    <button type="submit" class="submit-button" disabled={submitting || currentRating === null || !username}>
                        {submitting ? 'Submitting...' : 'Submit Rating & Next Article'}
                    </button>
                </form>
            </article>
        {:else if error}
             <p class="error">Error: {error}</p>
             <button on:click={fetchNextArticle} disabled={isLoading}>Try Loading Next Article</button>
        {/if}

        <!-- Lower Section: Leaderboard Toggle -->
        <section class="action-toggles">
            <!-- Button for Leaderboard -->
            <div class="toggle-container">
                <button on:click={toggleLeaderboard} disabled={isLoadingLeaderboard} class="toggle-button">
                    {#if isLoadingLeaderboard}
                        Loading...
                    {:else if showLeaderboard}
                        Hide Leaderboard
                    {:else}
                        Show Leaderboard
                    {/if}
                </button>

                {#if leaderboardError}
                    <p class="error">{leaderboardError}</p>
                {/if}

                {#if showLeaderboard && leaderboardData.length > 0}
                    <div class="collapsible-content">
                        <h3>Leaderboard</h3>
                        <table class="data-table leaderboard-table">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>User</th>
                                    <th>Labels Submitted</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each leaderboardData as user, i}
                                    <tr>
                                        <td>{i + 1}</td>
                                        <td>{user.username}</td>
                                        <td>{user.count}</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {:else if showLeaderboard}
                    <p class="collapsible-content">No leaderboard data available yet.</p>
                {/if}
            </div>
        </section>
    </div>
</main>

<style>
    /* --- Modal Styles --- */
    .modal-overlay {
        position: fixed; /* Sit on top */
        left: 0;
        top: 0;
        width: 100%; 
        height: 100%; 
        overflow: auto; /* Enable scroll if needed */
        background-color: rgba(0,0,0,0.6); /* Black w/ opacity */
        z-index: 1000; /* Sit on top */
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .modal-content {
        background-color: #fefefe;
        margin: auto;
        padding: 30px;
        border: 1px solid #888;
        width: 80%;
        max-width: 500px;
        border-radius: 8px;
        box-shadow: 0 4px 8px 0 rgba(0,0,0,0.2),0 6px 20px 0 rgba(0,0,0,0.19);
        text-align: center;
    }
    .modal-content h2 {
        margin-top: 0;
        margin-bottom: 15px;
    }
    .modal-content p {
        margin-bottom: 20px;
        color: #555;
    }
    .modal-content input[type="text"] {
        width: calc(100% - 22px); /* Full width minus padding/border */
        padding: 10px;
        margin-bottom: 10px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 1rem;
    }
    .modal-error {
        color: #d9534f;
        font-size: 0.9em;
        margin-bottom: 15px;
        margin-top: -5px;
    }
    .modal-confirm-button {
        background-color: #28a745; /* Green */
        color: white;
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
        width: auto; /* Don't force full width */
        display: inline-block;
    }
    .modal-confirm-button:hover {
        background-color: #218838;
    }

    /* Blur background when modal is active */
    .blurred > *:not(.modal-overlay) {
        filter: blur(5px);
        pointer-events: none; /* Prevent interaction with blurred background */
        user-select: none; /* Prevent text selection */
    }

    /* --- Rest of Styles --- */
    main {
        max-width: 900px; 
        margin: 2rem auto;
        padding: 1rem;
        font-family: sans-serif;
        background-color: #f9f9f9;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        /* Ensure main doesn't get blurred */
        position: relative; 
        z-index: 1; 
    }

    h1 {
        text-align: center;
        color: #333;
        border-bottom: 1px solid #eee;
        padding-bottom: 0.5rem;
        margin-top: 1rem; 
        margin-bottom: 1.5rem;
    }

    article {
        background-color: #fff;
        padding: 1.5rem;
        border-radius: 6px;
        border: 1px solid #ddd;
        margin-bottom: 1rem; 
    }

    h2 {
        margin-top: 0;
        color: #444;
        margin-bottom: 1rem;
    }

    .article-text {
        max-height: 300px; 
        overflow-y: auto;
        border: 1px solid #eee;
        padding: 0.5rem 1rem;
        margin-bottom: 1.5rem;
        background-color: #fdfdfd;
        white-space: pre-wrap; 
        line-height: 1.6;
    }

    fieldset {
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 1rem;
        margin-bottom: 1rem;
        background-color: #fefefe;
    }

    legend {
        font-weight: bold;
        padding: 0 0.5rem;
        color: #555;
    }

    label {
        display: block;
        margin-bottom: 0.5rem;
        cursor: pointer;
    }

    input[type="radio"] {
        margin-right: 0.5rem;
    }

    button {
        display: block;
        padding: 0.7rem 1rem; 
        font-size: 0.95rem;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        margin-top: 0.5rem; 
    }

    button.submit-button {
         width: 100%;
         background-color: #007bff;
         margin-top: 1rem; 
    }
    button.submit-button:hover:not(:disabled) {
        background-color: #0056b3;
    }

    button.toggle-button {
        width: auto; 
        background-color: #6c757d; 
        margin-bottom: 0.5rem; 
    }
    button.toggle-button:hover:not(:disabled) {
        background-color: #5a6268;
    }

    button:disabled {
        background-color: #cccccc;
        cursor: not-allowed;
    }

    .error {
        color: #d9534f; 
        background-color: #f2dede;
        border: 1px solid #ebccd1;
        padding: 0.75rem 1.25rem;
        border-radius: 0.25rem;
        margin: 0.5rem 0; 
    }
    .error-inline {
        color: #d9534f;
        font-size: 0.9em;
    }
    .input-error { /* Style removed as input is now in modal */
       
    }

    /* --- Header Styles --- */
    .status-header {
        display: flex;
        justify-content: space-between;
        align-items: center; /* Center items vertically */
        flex-wrap: wrap; 
        gap: 1rem;
        padding: 0.5rem 0;
        margin-bottom: 1rem;
        font-size: 0.9em;
    }

    .username-display {
        font-weight: normal;
    }
    .username-display strong {
         font-weight: bold;
    }
    
    .progress-meter {
        display: flex;
        flex-direction: column; 
        align-items: flex-end; 
        gap: 0.25rem;
        text-align: right;
    }
    .progress-meter progress {
        width: 250px; 
        height: 12px;
    }
    .progress-meter span {
        display: block;
    }

    /* --- Lower Section Styles --- */
    .action-toggles {
        display: grid;
        /* Adjust grid if only one item remains */
        grid-template-columns: 1fr; /* Or adjust as needed if keeping grid */
        gap: 1.5rem;
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid #eee;
    }

    .toggle-container {
       
    }

    .collapsible-content {
        margin-top: 0.5rem;
        padding-left: 0.5rem; 
    }

    .collapsible-content h3 {
        margin-bottom: 0.5rem;
        color: #333;
        font-size: 1.1em;
    }

    .data-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.5rem;
        background-color: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        font-size: 0.9em;
    }

    .data-table th, 
    .data-table td {
        border: 1px solid #ddd;
        padding: 0.4rem 0.6rem;
        text-align: left;
        vertical-align: top;
    }

    .data-table th {
        background-color: #f2f2f2;
        font-weight: bold;
        white-space: nowrap;
    }

    .data-table tbody tr:nth-child(even) {
        background-color: #f9f9f9;
    }

    .data-table tbody tr:hover {
        background-color: #e9ecef;
    }

    .leaderboard-table td:nth-child(2) {
         font-weight: bold;
    }

</style>
