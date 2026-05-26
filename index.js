const express = require('express');
const cors = require('cors');
const { exec } = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'yt-dlp-backend' });
});

// Endpoint: /api/info
app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta la URL' });

    try {
        const output = await exec(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
            youtubeSkipDashManifest: true,
        });
        
        // Formatear salida para el frontend
        const formats = output.formats || [];
        
        const videos = formats.filter(f => f.vcodec !== 'none');
        const audios = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
        
        // Extraer resoluciones únicas
        const qualities = [...new Set(videos.map(v => v.height).filter(h => h))].sort((a, b) => b - a);

        res.json({
            title: output.title,
            thumbnail: output.thumbnail,
            duration: output.duration,
            qualities: qualities.map(q => `${q}p`),
            hasAudio: audios.length > 0
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'No se pudo obtener información del video' });
    }
});

// Endpoint: /api/download
app.get('/api/download', async (req, res) => {
    const { url, quality, format } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta la URL' });

    const isMp3 = format === 'mp3';
    const targetHeight = quality ? quality.replace('p', '') : '1080';
    
    // Crear carpeta temporal si no existe
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    
    const id = uuidv4();
    const ext = isMp3 ? 'mp3' : 'mp4';
    const outputPath = path.join(tempDir, `${id}.${ext}`);
    
    // Argumentos para yt-dlp
    const args = {
        noWarnings: true,
        noCallHome: true,
        noCheckCertificate: true,
        youtubeSkipDashManifest: true,
        output: outputPath
    };

    if (isMp3) {
        args.extractAudio = true;
        args.audioFormat = 'mp3';
        args.audioQuality = 0;
    } else {
        // Mejor video hasta X calidad + mejor audio, combinado en mp4
        args.format = `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
        args.mergeOutputFormat = 'mp4';
    }

    try {
        console.log(`Iniciando descarga: ${url} (Calidad: ${quality || '1080p'})`);
        // Ejecutar descarga
        await exec(url, args);
        
        if (!fs.existsSync(outputPath)) {
            throw new Error('El archivo no se generó correctamente');
        }

        const safeTitle = req.query.title ? req.query.title.replace(/[^a-zA-Z0-9 ]/g, '_') : 'video';
        
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
        res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'video/mp4');
        
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);
        
        // Eliminar archivo después de enviarlo
        fileStream.on('close', () => {
            fs.unlink(outputPath, (err) => {
                if (err) console.error('Error eliminando archivo temporal:', err);
                else console.log(`Archivo temporal eliminado: ${id}.${ext}`);
            });
        });
        
    } catch (error) {
        console.error('Error en descarga:', error);
        // Intentar limpiar en caso de error
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error durante la descarga o procesamiento del video.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Backend de yt-dlp corriendo en puerto ${PORT}`);
});
