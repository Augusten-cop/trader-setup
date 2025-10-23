const fs = require('fs');
const path = require('path');

// Simple debug endpoint to list data files
app.get('/api/debug/files', (req, res) => {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        return res.json({ error: 'Data directory not found', path: dataDir });
    }
    
    try {
        const files = fs.readdirSync(dataDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(dataDir, f);
                const stats = fs.statSync(fullPath);
                return {
                    name: f,
                    size: stats.size,
                    modified: stats.mtime,
                    content: fs.readFileSync(fullPath, 'utf8').slice(0, 200) + '...'
                };
            });
        res.json({ files });
    } catch (error) {
        res.json({ error: error.message });
    }
});
