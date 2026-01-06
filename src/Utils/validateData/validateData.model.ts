// ! TYPE
export interface ValidationMessage {
    field: string;
    rule: string;
    message: string;
    meta?: Record<string, any>;
}