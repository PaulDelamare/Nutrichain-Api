/**
 * Classe d'erreur standard pour l'API NutriChain.
 * Permet de renvoyer des erreurs structurées avec un code HTTP et des détails par champ.
 */
export class APIError extends Error {
  constructor(
    public status: number,
    public body: {
      error: Array<{
        field: string;
        message: string;
      }>;
    }
  ) {
    super(`API Error: ${status}`);
    // Nécessaire pour maintenir la chaîne de prototypes correcte en TS/JS
    Object.setPrototypeOf(this, APIError.prototype);
    this.name = 'APIError';
  }
}
