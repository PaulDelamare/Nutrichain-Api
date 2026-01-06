import { describe, it, expect, afterEach } from 'vitest';
import { createFileIfDoesNotExist } from './createFile';
import fs from 'fs/promises';

describe('createFileIfDoesNotExist', () => {
    const testFileName = 'testFile.txt';

    afterEach(async () => {
        try {
            await fs.unlink(testFileName);
        } catch (error) {
        }
    });

    it('should create a file if it does not exist', async () => {
        await createFileIfDoesNotExist(testFileName);

        const fileExists = await fs.access(testFileName).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);
    });

    it('should not create a file if it already exists', async () => {
        await fs.writeFile(testFileName, 'initial content', 'utf-8');

        await createFileIfDoesNotExist(testFileName);

        const fileContent = await fs.readFile(testFileName, 'utf-8');
        expect(fileContent).toBe('initial content');
    });
});