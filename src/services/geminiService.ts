import { GoogleGenAI, Type } from "@google/genai";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface DiagnosticResult {
  diagnosis: string;
  severity: 'low' | 'medium' | 'high';
  estimatedCost: string;
  recommendedCategory: 'car' | 'bike' | 'both';
  nextSteps: string[];
}

export async function diagnoseIssue(issueDescription: string, vehicleInfo: string): Promise<DiagnosticResult> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    You are an expert automotive and motorcycle diagnostic AI. 
    A user is reporting an issue with their vehicle.
    
    Vehicle Info: ${vehicleInfo}
    Issue Description: ${issueDescription}
    
    Analyze the issue and provide a structured diagnosis.
    Be professional, helpful, and prioritize safety.
    CRITICAL: All monetary values and costs MUST be in Indian Rupees (INR) using the ₹ symbol. NEVER use dollars ($).
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          diagnosis: {
            type: Type.STRING,
            description: "A clear, concise explanation of what might be wrong."
          },
          severity: {
            type: Type.STRING,
            enum: ["low", "medium", "high"],
            description: "The urgency of the repair."
          },
          estimatedCost: {
            type: Type.STRING,
            description: "A rough estimate range for the repair in Indian Rupees only. Example: ₹500 - ₹1500. DO NOT USE DOLLARS."
          },
          recommendedCategory: {
            type: Type.STRING,
            enum: ["car", "bike", "both"],
            description: "The type of mechanic best suited for this."
          },
          nextSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "A list of immediate actions the user should take."
          }
        },
        required: ["diagnosis", "severity", "estimatedCost", "recommendedCategory", "nextSteps"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}') as DiagnosticResult;
  } catch (e) {
    console.error("Failed to parse AI response:", e);
    throw new Error("AI Assistant is currently unavailable.");
  }
}
