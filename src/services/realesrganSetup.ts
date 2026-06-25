import fs from 'fs';
import path from 'path';
import https from 'https';
import AdmZip from 'adm-zip';

const ZIP_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/realesrgan-ncnn-vulkan-20220424-windows.zip';

// We can download and extract directly in the workspace
export async function downloadAndSetupRealESRGAN(onProgress?: (msg: string) => void): Promise<string> {
  const tempZipPath = path.join(process.cwd(), 'realesrgan-windows.zip');
  const destDir = path.join(process.cwd(), 'realesrgan-ncnn-vulkan');

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const log = (msg: string) => {
    console.log(`[Real-ESRGAN Setup] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  // Helper to download with redirect support
  const downloadWithRedirect = (url: string, dest: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      
      const request = https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect location header missing'));
            return;
          }
          log(`重定向至: ${redirectUrl}`);
          file.close();
          fs.unlink(dest, () => {});
          downloadWithRedirect(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`下载失败，状态码: ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  };

  try {
    log('开始从 GitHub 下载 Real-ESRGAN Windows 预编译压缩包 (约 25MB)...');
    await downloadWithRedirect(ZIP_URL, tempZipPath);
    
    log('下载成功！开始解压资源文件...');
    const zip = new AdmZip(tempZipPath);
    zip.extractAllTo(destDir, true);
    log('解压完成！');

    // Flatten folder if needed
    const extractedSubdirName = 'realesrgan-ncnn-vulkan-20220424-windows';
    const subDirPath = path.join(destDir, extractedSubdirName);
    
    if (fs.existsSync(subDirPath)) {
      log('整理并平铺目录结构...');
      const files = fs.readdirSync(subDirPath);
      for (const file of files) {
        const srcPath = path.join(subDirPath, file);
        const destPath = path.join(destDir, file);
        
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        
        fs.renameSync(srcPath, destPath);
      }
      fs.rmSync(subDirPath, { recursive: true, force: true });
    }

    // Clean up temporary zip
    if (fs.existsSync(tempZipPath)) {
      fs.unlinkSync(tempZipPath);
      log('清理临时压缩包文件。');
    }

    const execPath = path.join('realesrgan-ncnn-vulkan', 'realesrgan-ncnn-vulkan.exe');
    log(`部署成功！执行文件位于: ${execPath}`);
    return execPath;
  } catch (error: any) {
    // Make sure we clean up temp zip on error
    if (fs.existsSync(tempZipPath)) {
      try { fs.unlinkSync(tempZipPath); } catch (e) {}
    }
    log(`配置失败: ${error.message}`);
    throw error;
  }
}
