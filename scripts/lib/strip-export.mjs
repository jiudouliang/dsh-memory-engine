export function stripRendererExport(source) {
  const declaration = /^export (?=function createRenderer\()/m;
  if (!declaration.test(source)) throw new Error('Missing createRenderer export');
  const stripped = source.replace(declaration, '');
  if (/^\s*(?:import|export)\b/m.test(stripped)) throw new Error('Renderer must be a standalone browser function');
  return stripped;
}
